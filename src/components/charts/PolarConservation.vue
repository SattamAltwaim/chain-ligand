<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="chart-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import Highcharts from '../../utils/highchartsConfig'
import { withExporting } from '../../utils/highchartsConfig'
import HighchartsMore from 'highcharts/highcharts-more'
import { useAnalysisStore } from '../../stores/analysisStore'
import { useChartUiStore } from '../../stores/chartUiStore'
import { useSystemsStore } from '../../stores/systemsStore'
import { getInteractionBaseColor, formatResidueId } from '../../utils/chartHelpers'
import { INTERACTION_TYPES } from '../../utils/constants'

HighchartsMore(Highcharts)

const analysisStore = useAnalysisStore()
const chartUiStore = useChartUiStore()
const systemsStore = useSystemsStore()
const chartContainer = ref(null)
let chart = null

/**
 * Build per-residue type PROPORTIONS.
 * For each chain-B residue, sum up type-frame occurrences across all interaction rows,
 * then divide each type's count by the total. This gives "out of this residue's
 * interactions, X% is CH-O/N, Y% is π-π" — they sum to 100%.
 * The stacked bar total = pair conservation.
 */
function buildResidueProportions(interactions) {
  const residueMap = new Map()

  for (const row of interactions) {
    const key = formatResidueId(row.resName2, row.resNum2, row.chain2)
    if (!key) continue

    if (!residueMap.has(key)) {
      residueMap.set(key, {
        id: key,
        resNum: row.resNum2,
        consistency: 0,
        typeCounts: {}   // type -> total frame appearances
      })
    }
    const entry = residueMap.get(key)
    if ((row.consistency || 0) > entry.consistency) entry.consistency = row.consistency

    // Count frames per type from typeFrames
    if (row.typeFrames) {
      for (const [type, frames] of Object.entries(row.typeFrames)) {
        const uniqueCount = new Set(frames).size
        entry.typeCounts[type] = (entry.typeCounts[type] || 0) + uniqueCount
      }
    } else if (row.typePersistence) {
      // Fallback: use persistence * totalFrames as approximate count
      const totalFrames = row.frameCount || 1
      for (const [type, pers] of Object.entries(row.typePersistence)) {
        entry.typeCounts[type] = (entry.typeCounts[type] || 0) + Math.round(pers * totalFrames)
      }
    }
  }

  // Convert counts to proportions
  return Array.from(residueMap.values()).map(entry => {
    const totalCounts = Object.values(entry.typeCounts).reduce((s, c) => s + c, 0)
    const typeProportions = {}
    for (const [type, count] of Object.entries(entry.typeCounts)) {
      typeProportions[type] = totalCounts > 0 ? count / totalCounts : 0
    }
    return { ...entry, typeProportions, totalCounts }
  }).sort((a, b) => a.resNum - b.resNum)
}

const updateChart = () => {
  if (!chartContainer.value) return

  const interactions = analysisStore.filteredInteractions
  if (!interactions.length) {
    if (chart) { chart.destroy(); chart = null }
    chartContainer.value.innerHTML = '<div style="text-align:center;padding:100px 20px;color:#6e6e73;font-size:19px;">No interactions above threshold.</div>'
    return
  }

  const systemName = systemsStore.currentSystem?.name || 'System'
  const residues = buildResidueProportions(interactions)
  const categories = residues.map(r => r.id)

  // Build stacked series: each type's segment height = proportion * pair_conservation
  // This way bars stack to pair_conservation (not beyond 100%)
  const series = []
  for (const it of INTERACTION_TYPES) {
    const data = residues.map(res => {
      const conservationPct = Math.round(res.consistency * 100)
      for (const [type, proportion] of Object.entries(res.typeProportions)) {
        if (it.keywords.some(kw => type.toLowerCase().includes(kw.toLowerCase()))) {
          return Math.round(proportion * conservationPct)
        }
      }
      return 0
    })
    if (data.some(v => v > 0)) {
      series.push({
        name: it.label,
        data,
        color: getInteractionBaseColor(it.label),
        pointPlacement: 'on'
      })
    }
  }

  if (!series.length) {
    if (chart) { chart.destroy(); chart = null }
    chartContainer.value.innerHTML = '<div style="text-align:center;padding:100px 20px;color:#6e6e73;font-size:19px;">No interaction types found.</div>'
    return
  }

  if (chart) chart.destroy()

  const chartOptions = {
    chart: {
      polar: true,
      type: 'column',
      backgroundColor: 'transparent',
      height: 720
    },
    title: {
      text: `${systemName} — Polar Conservation Fingerprint`,
      style: { fontSize: '24px', fontWeight: '600', color: '#1d1d1f' }
    },
    subtitle: {
      text: `Bar height = pair conservation | Segments = interaction type share within that pair`,
      style: { fontSize: '14px', color: '#6e6e73' }
    },
    credits: { enabled: false },
    pane: { size: '75%' },
    xAxis: {
      categories,
      tickmarkPlacement: 'on',
      lineWidth: 0,
      labels: {
        style: { fontSize: '10px', fontWeight: '600', color: '#1d1d1f' },
        distance: 20
      }
    },
    yAxis: {
      min: 0,
      max: 100,
      endOnTick: false,
      showLastLabel: true,
      title: { text: null },
      labels: {
        format: '{value}%',
        style: { fontSize: '10px', color: '#6e6e73' }
      },
      gridLineInterpolation: 'circle',
      gridLineColor: '#e8e8ed'
    },
    legend: {
      align: 'right', verticalAlign: 'middle', layout: 'vertical',
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#1d1d1f' }
    },
    plotOptions: {
      column: { stacking: 'normal', pointPadding: 0, groupPadding: 0, borderWidth: 1, borderColor: '#ffffff' }
    },
    series,
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderRadius: 12, borderWidth: 1, borderColor: '#d2d2d7',
      shared: true, useHTML: true,
      formatter: function () {
        const idx = this.points?.[0]?.point?.index
        const res = residues[idx]
        let html = `<div style="padding:10px;"><div style="font-size:15px;font-weight:700;margin-bottom:6px;">${res ? res.id : this.x}</div>`
        if (res) html += `<div style="margin-bottom:6px;">Pair conservation: <b>${Math.round(res.consistency * 100)}%</b></div>`
        const total = this.points.reduce((s, p) => s + (p.y || 0), 0)
        for (const p of this.points) {
          if (p.y > 0) {
            const share = total > 0 ? Math.round(p.y / total * 100) : 0
            html += `<div style="margin-bottom:2px;"><span style="color:${p.color};font-weight:600;">&#9679;</span> ${p.series.name}: <b>${p.y}%</b> (${share}% of interactions)</div>`
          }
        }
        html += '</div>'
        return html
      }
    }
  }

  chart = Highcharts.chart(chartContainer.value, withExporting(chartOptions, `polar-conservation-${systemsStore.currentSystem?.id || 'unknown'}`))
}

onMounted(updateChart)
watch([
  () => chartUiStore.currentChartType,
  () => analysisStore.filteredInteractions.length,
  () => chartUiStore.currentThreshold,
  () => systemsStore.currentSystem?.id
], () => {
  if (chartUiStore.currentChartType === 'polarConservation') updateChart()
}, { deep: true })
</script>

<style scoped>
.chart-wrapper { width: 100%; height: 100%; }
.chart-container { width: 100%; min-height: 720px; }
</style>
