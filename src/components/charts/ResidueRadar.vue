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
import { formatResidueId } from '../../utils/chartHelpers'

HighchartsMore(Highcharts)

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

  // Build per-residue overall conservation
  const residueMap = new Map()
  for (const row of interactions) {
    const key = formatResidueId(row.resName2, row.resNum2, row.chain2)
    if (!key) continue
    if (!residueMap.has(key)) {
      residueMap.set(key, { id: key, resNum: row.resNum2, consistency: 0 })
    }
    const entry = residueMap.get(key)
    if ((row.consistency || 0) > entry.consistency) entry.consistency = row.consistency
  }

  const residues = Array.from(residueMap.values()).sort((a, b) => a.resNum - b.resNum)
  const categories = residues.map(r => r.id)
  const conservationData = residues.map(r => Math.round(r.consistency * 100))

  if (chart) chart.destroy()

  const chartOptions = {
    chart: {
      polar: true,
      backgroundColor: 'transparent',
      height: 720
    },
    title: {
      text: `${systemName} — Residue Interaction Radar`,
      style: { fontSize: '24px', fontWeight: '600', color: '#1d1d1f' }
    },
    subtitle: {
      text: `Each axis = chain B residue | Shape = overall pair conservation %`,
      style: { fontSize: '14px', color: '#6e6e73' }
    },
    credits: { enabled: false },
    pane: { size: '70%' },
    xAxis: {
      categories,
      tickmarkPlacement: 'on',
      lineWidth: 0,
      labels: {
        style: { fontSize: '11px', fontWeight: '600', color: '#1d1d1f' },
        distance: 25
      }
    },
    yAxis: {
      min: 0,
      max: 100,
      tickInterval: 25,
      gridLineInterpolation: 'polygon',
      gridLineColor: '#d2d2d7',
      gridLineWidth: 1,
      labels: {
        format: '{value}%',
        style: { fontSize: '10px', color: '#6e6e73' }
      },
      title: { text: null }
    },
    legend: { enabled: false },
    series: [{
      name: 'Overall Conservation',
      data: conservationData,
      type: 'area',
      color: '#1d1d1f',
      fillColor: 'rgba(29, 29, 31, 0.10)',
      pointPlacement: 'on',
      lineWidth: 3,
      marker: {
        enabled: true,
        radius: 5,
        symbol: 'diamond',
        lineWidth: 2,
        lineColor: '#1d1d1f',
        fillColor: '#ffffff'
      }
    }],
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderRadius: 12, borderWidth: 1, borderColor: '#d2d2d7',
      useHTML: true,
      formatter: function () {
        const idx = this.point.index
        const res = residues[idx]
        if (!res) return ''
        return `<div style="padding:10px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${res.id}</div>
          <div>Conservation: <b>${Math.round(res.consistency * 100)}%</b></div>
        </div>`
      }
    }
  }

  chart = Highcharts.chart(chartContainer.value, withExporting(chartOptions, `residue-radar-${systemsStore.currentSystem?.id || 'unknown'}`))
}

onMounted(updateChart)
watch([
  () => chartUiStore.currentChartType,
  () => analysisStore.filteredInteractions.length,
  () => chartUiStore.currentThreshold,
  () => systemsStore.currentSystem?.id
], () => {
  if (chartUiStore.currentChartType === 'residueRadar') updateChart()
}, { deep: true })
</script>

<style scoped>
.chart-wrapper { width: 100%; height: 100%; }
.chart-container { width: 100%; min-height: 720px; }
</style>
