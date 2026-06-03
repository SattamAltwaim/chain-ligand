<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="chart-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import Highcharts from '../../utils/highchartsConfig'
import { withExporting } from '../../utils/highchartsConfig'
import HeatmapModule from 'highcharts/modules/heatmap'
import { useAnalysisStore } from '../../stores/analysisStore'
import { useChartUiStore } from '../../stores/chartUiStore'
import { useSystemsStore } from '../../stores/systemsStore'
import { getInteractionColorArray, getInteractionBaseColor, formatResidueId } from '../../utils/chartHelpers'

HeatmapModule(Highcharts)

const analysisStore = useAnalysisStore()
const chartUiStore = useChartUiStore()
const systemsStore = useSystemsStore()
const chartContainer = ref(null)
let chart = null

const updateChart = () => {
  if (!chartContainer.value) return

  const interactions = analysisStore.filteredInteractions
  if (!interactions.length) {
    if (chart) { chart.destroy(); chart = null }
    chartContainer.value.innerHTML = '<div style="text-align:center;padding:100px 20px;color:#6e6e73;font-size:19px;">No interactions above threshold.</div>'
    return
  }

  const totalFrames = systemsStore.totalFrames || 1
  const systemName = systemsStore.currentSystem?.name || 'System'
  const frameLabels = Array.from({ length: totalFrames }, (_, i) => `${i + 1}`)

  // Collect unique chain2 residues from filtered interactions, sorted by conservation
  const residueMap = new Map()
  for (const row of interactions) {
    const key = formatResidueId(row.resName2, row.resNum2, row.chain2)
    if (!key) continue
    if (!residueMap.has(key)) {
      residueMap.set(key, { id: key, consistency: row.consistency || 0 })
    }
    if ((row.consistency || 0) > residueMap.get(key).consistency) {
      residueMap.get(key).consistency = row.consistency
    }
  }
  const sortedResidues = Array.from(residueMap.values()).sort((a, b) => b.consistency - a.consistency)
  const residueLabels = sortedResidues.map(r => r.id)

  // Build frame-level lookup from aggregated interactions.
  // Each row has typeFrames: { "π-π interactions": [1,2,3], "CH-O/N bonds": [1,4,5], ... }
  // We invert this to: residueId -> frame -> "type1;type2"
  const rawInteractions = analysisStore.interactions
  const lookup = new Map()
  for (const row of rawInteractions) {
    const key = formatResidueId(row.resName2, row.resNum2, row.chain2)
    if (!key || !residueMap.has(key)) continue
    if (!lookup.has(key)) lookup.set(key, new Map())
    const frameLookup = lookup.get(key)

    if (row.typeFrames) {
      // Invert typeFrames: for each frame, collect all types present
      for (const [type, frames] of Object.entries(row.typeFrames)) {
        for (const f of frames) {
          const existing = frameLookup.get(f)
          frameLookup.set(f, existing ? `${existing};${type}` : type)
        }
      }
    } else if (row.frames && row.typesArray) {
      // Fallback: mark all frames with all types
      const typesStr = row.typesArray.join(';')
      for (const f of row.frames) {
        frameLookup.set(f, typesStr)
      }
    }
  }

  // Build heatmap data
  const data = []
  for (let yIdx = 0; yIdx < sortedResidues.length; yIdx++) {
    const resKey = sortedResidues[yIdx].id
    const frameLookup = lookup.get(resKey) || new Map()

    for (let xIdx = 0; xIdx < totalFrames; xIdx++) {
      const frame = xIdx + 1
      const types = frameLookup.get(frame)
      if (types) {
        const firstType = types.split(';')[0].trim()
        const colorArr = getInteractionColorArray(firstType)
        data.push({
          x: xIdx, y: yIdx, value: 1,
          color: `rgb(${colorArr[0]}, ${colorArr[1]}, ${colorArr[2]})`,
          custom: { types, residue: resKey, frame }
        })
      } else {
        data.push({ x: xIdx, y: yIdx, value: 0, color: '#f5f5f7' })
      }
    }
  }

  if (chart) chart.destroy()

  const chartHeight = Math.max(500, sortedResidues.length * 26 + 200)

  const chartOptions = {
    chart: {
      type: 'heatmap',
      backgroundColor: 'transparent',
      height: chartHeight
    },
    title: {
      text: `${systemName} — Interaction Timeline`,
      style: { fontSize: '24px', fontWeight: '600', color: '#1d1d1f' }
    },
    subtitle: {
      text: `Each cell colored by dominant interaction type in that frame`,
      style: { fontSize: '14px', color: '#6e6e73' }
    },
    credits: { enabled: false },
    xAxis: {
      categories: frameLabels,
      title: {
        text: chartUiStore.timeUnit ? `Time (${chartUiStore.timeUnit})` : 'Frame',
        style: { fontSize: '14px', fontWeight: '600', color: '#1d1d1f' }
      },
      labels: { style: { fontSize: '11px', color: '#1d1d1f' } }
    },
    yAxis: {
      categories: residueLabels,
      title: { text: null },
      labels: { style: { fontSize: '10px', fontWeight: '600', color: '#1d1d1f' } },
      reversed: false
    },
    colorAxis: { min: 0, max: 1, visible: false },
    legend: { enabled: false },
    plotOptions: {
      heatmap: { borderWidth: 2, borderColor: '#ffffff', borderRadius: 3 }
    },
    series: [{
      name: 'Interactions',
      data,
      turboThreshold: 10000
    }],
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderRadius: 12, borderWidth: 1, borderColor: '#d2d2d7',
      useHTML: true,
      formatter: function () {
        const c = this.point.options.custom
        if (!c || !c.types) {
          return `<div style="padding:10px;"><b>Frame ${this.point.x + 1}</b> &#215; ${residueLabels[this.point.y]}<br/><span style="color:#6e6e73;">No interaction</span></div>`
        }
        const types = c.types.split(';').map(t => {
          const color = getInteractionBaseColor(t.trim())
          return `<span style="color:${color};font-weight:600;">&#9679;</span> ${t.trim()}`
        }).join('<br/>')
        return `<div style="padding:12px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:6px;">Frame ${c.frame} &#8212; ${c.residue}</div>
          ${types}
        </div>`
      }
    }
  }

  chart = Highcharts.chart(chartContainer.value, withExporting(chartOptions, `interaction-timeline-${systemsStore.currentSystem?.id || 'unknown'}`))
}

onMounted(updateChart)
watch([
  () => chartUiStore.currentChartType,
  () => analysisStore.filteredInteractions.length,
  () => chartUiStore.currentThreshold,
  () => systemsStore.currentSystem?.id,
  () => chartUiStore.timeUnit
], () => {
  if (chartUiStore.currentChartType === 'interactionTimeline') updateChart()
}, { deep: true })
</script>

<style scoped>
.chart-wrapper { width: 100%; height: 100%; }
.chart-container { width: 100%; min-height: 500px; }
</style>
