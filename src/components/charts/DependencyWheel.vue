<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="chart-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import Highcharts from '../../utils/highchartsConfig'
import { withExporting } from '../../utils/highchartsConfig'
import SankeyModule from 'highcharts/modules/sankey'
import DependencyWheelModule from 'highcharts/modules/dependency-wheel'
import { useAnalysisStore } from '../../stores/analysisStore'
import { useChartUiStore } from '../../stores/chartUiStore'
import { useSystemsStore } from '../../stores/systemsStore'
import { getInteractionBaseColor, getInteractionColorArray, formatResidueId } from '../../utils/chartHelpers'

SankeyModule(Highcharts)
DependencyWheelModule(Highcharts)

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

  const systemName = systemsStore.currentSystem?.name || 'System'

  // Build one link per unique residue pair, colored by dominant type
  const pairMap = new Map()
  for (const row of interactions) {
    const fromId = formatResidueId(row.resName1, row.resNum1, row.chain1)
    const toId = formatResidueId(row.resName2, row.resNum2, row.chain2)
    const key = `${fromId}__${toId}`
    if (!pairMap.has(key)) {
      pairMap.set(key, {
        from: fromId,
        to: toId,
        consistency: row.consistency || 0,
        types: (row.types || '').split(';').map(t => t.trim()).filter(Boolean)
      })
    }
  }

  const data = Array.from(pairMap.values()).map(pair => {
    const dominantType = pair.types[0] || 'Unknown'
    const colorArr = getInteractionColorArray(dominantType)
    return {
      from: pair.from,
      to: pair.to,
      weight: Math.max(1, Math.round(pair.consistency * 100)),
      color: `rgba(${colorArr[0]}, ${colorArr[1]}, ${colorArr[2]}, 0.6)`,
      custom: {
        dominantType,
        conservation: Math.round(pair.consistency * 100),
        allTypes: pair.types
      }
    }
  })

  if (chart) chart.destroy()

  const chartOptions = {
    chart: {
      backgroundColor: 'transparent',
      height: 720
    },
    title: {
      text: `${systemName} — Interaction Dependency Wheel`,
      style: { fontSize: '24px', fontWeight: '600', color: '#1d1d1f' }
    },
    subtitle: {
      text: `Link color = dominant interaction type | Link thickness = conservation %`,
      style: { fontSize: '14px', color: '#6e6e73' }
    },
    credits: { enabled: false },
    series: [{
      type: 'dependencywheel',
      name: 'Interactions',
      data,
      dataLabels: {
        enabled: true,
        style: { fontSize: '10px', fontWeight: '500', color: '#1d1d1f', textOutline: '2px rgba(255,255,255,0.8)' },
        textPath: { enabled: true, attributes: { dy: 5 } },
        distance: 10
      },
      size: '88%'
    }],
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#d2d2d7',
      useHTML: true,
      nodeFormatter: function () {
        const links = this.linksFrom.concat(this.linksTo)
        const count = links.length
        return `<div style="padding:10px"><b style="font-size:15px;">${this.id}</b><br/>${count} interactions</div>`
      },
      pointFormatter: function () {
        const c = this.options.custom
        if (!c) return ''
        const typeList = c.allTypes.map(t => {
          const color = getInteractionBaseColor(t)
          return `<span style="color:${color};font-weight:600;">&#9679;</span> ${t}`
        }).join('<br/>')
        return `<div style="padding:12px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${this.from} &#8596; ${this.to}</div>
          ${typeList}<br/>
          Conservation: <b>${c.conservation}%</b>
        </div>`
      }
    }
  }

  chart = Highcharts.chart(chartContainer.value, withExporting(chartOptions, `dependency-wheel-${systemsStore.currentSystem?.id || 'unknown'}`))
}

onMounted(updateChart)
watch([
  () => chartUiStore.currentChartType,
  () => analysisStore.filteredInteractions.length,
  () => chartUiStore.currentThreshold,
  () => systemsStore.currentSystem?.id
], () => {
  if (chartUiStore.currentChartType === 'dependencyWheel') updateChart()
}, { deep: true })
</script>

<style scoped>
.chart-wrapper { width: 100%; height: 100%; }
.chart-container { width: 100%; min-height: 720px; }
</style>
