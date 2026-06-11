<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="chart-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import Highcharts from '../../utils/highchartsConfig'
import { withExporting } from '../../utils/highchartsConfig'
import SankeyModule from 'highcharts/modules/sankey'
import { useAnalysisStore } from '../../stores/analysisStore'
import { useChartUiStore } from '../../stores/chartUiStore'
import { useSystemsStore } from '../../stores/systemsStore'
import { getInteractionBaseColor, getInteractionColorArray, formatResidueId, matchesSelectedTypes } from '../../utils/chartHelpers'
import { INTERACTION_TYPES } from '../../utils/constants'

SankeyModule(Highcharts)

const analysisStore = useAnalysisStore()
const chartUiStore = useChartUiStore()
const systemsStore = useSystemsStore()
const chartContainer = ref(null)
let chart = null
const hiddenLegendTypes = new Set()

const typeNodeId = (type) => `type:${type}`

const updateChart = () => {
  if (!chartContainer.value) return

  const interactions = analysisStore.filteredInteractions
  if (!interactions.length) {
    if (chart) {
      chart.destroy()
      chart = null
    }
    chartContainer.value.innerHTML = '<div style="text-align:center;padding:100px 20px;color:#6e6e73;font-size:19px;">No interactions above threshold.</div>'
    return
  }

  const links = []
  const nodes = new Map()
  const availableTypes = new Set()

  for (const row of interactions) {
    const source = formatResidueId(row.resName1, row.resNum1, row.chain1)
    const target = formatResidueId(row.resName2, row.resNum2, row.chain2)
    if (!source || !target) continue

    for (const type of row.typesArray || []) {
      if (!matchesSelectedTypes(type, chartUiStore.selectedInteractionTypes, INTERACTION_TYPES)) continue
      availableTypes.add(type)
      if (hiddenLegendTypes.has(type)) continue

      const persistence = row.typePersistence?.[type] ?? row.consistency ?? 0
      if (persistence <= 0) continue

      const typeId = typeNodeId(type)
      const color = getInteractionBaseColor(type)
      const colorArray = getInteractionColorArray(type)
      const linkColor = `rgba(${colorArray[0]}, ${colorArray[1]}, ${colorArray[2]}, 0.48)`
      const weight = Math.max(1, Math.round(persistence * 100))
      const custom = {
        pair: `${source} ↔ ${target}`,
        type,
        conservation: Math.round(persistence * 100)
      }

      nodes.set(source, {
        id: source,
        name: source,
        column: 0,
        color: '#3B6EF5',
        custom: { role: `Chain ${row.chain1} residue` }
      })
      nodes.set(target, {
        id: target,
        name: target,
        column: 2,
        color: '#8E8E93',
        custom: { role: `Chain ${row.chain2} residue` }
      })
      nodes.set(typeId, {
        id: typeId,
        name: type,
        column: 1,
        color,
        custom: { role: 'Interaction type' }
      })

      links.push({ from: source, to: typeId, weight, color: linkColor, custom })
      links.push({ from: typeId, to: target, weight, color: linkColor, custom })
    }
  }

  for (const type of hiddenLegendTypes) {
    if (!availableTypes.has(type)) hiddenLegendTypes.delete(type)
  }

  if (chart) chart.destroy()

  const systemName = systemsStore.currentSystem?.name || 'System'
  const chartOptions = {
    chart: {
      backgroundColor: 'transparent',
      height: 760,
      spacingTop: 30,
      spacingBottom: 30
    },
    title: {
      text: `${systemName} — Interaction Sankey Diagram`,
      style: { fontSize: '24px', fontWeight: '600', color: '#1d1d1f' }
    },
    subtitle: {
      text: 'Flow: chain A residue → interaction type → chain B residue | Link width = type conservation %',
      style: { fontSize: '14px', color: '#6e6e73' }
    },
    credits: { enabled: false },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'middle',
      layout: 'vertical',
      itemStyle: { fontSize: '11px', fontWeight: '500', color: '#1d1d1f' },
      itemHiddenStyle: { color: '#b6b6ba' },
      symbolRadius: 6
    },
    plotOptions: {
      series: {
        events: {
          legendItemClick: function () {
            const type = this.options.custom?.interactionType
            if (!type) return false

            if (hiddenLegendTypes.has(type)) hiddenLegendTypes.delete(type)
            else hiddenLegendTypes.add(type)

            setTimeout(updateChart, 0)
            return false
          }
        }
      }
    },
    series: [
      {
        type: 'sankey',
        name: 'Interaction flow',
        showInLegend: false,
        data: links,
        nodes: Array.from(nodes.values()),
        nodeWidth: 24,
        nodePadding: 16,
        borderWidth: 0,
        curveFactor: 0.45,
        linkOpacity: 0.7,
        minLinkWidth: 3,
        dataLabels: {
          enabled: true,
          nodeFormat: '{point.name}',
          style: {
            fontSize: '11px',
            fontWeight: '600',
            color: '#1d1d1f',
            textOutline: '2px rgba(255,255,255,0.9)'
          }
        }
      },
      ...[...availableTypes]
        .sort((a, b) => a.localeCompare(b))
        .map(type => ({
          type: 'scatter',
          name: type,
          color: getInteractionBaseColor(type),
          data: [],
          showInLegend: true,
          visible: !hiddenLegendTypes.has(type),
          enableMouseTracking: false,
          marker: { symbol: 'circle', radius: 6 },
          custom: { interactionType: type }
        }))
    ],
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#d2d2d7',
      useHTML: true,
      nodeFormatter: function () {
        const role = this.options.custom?.role || 'Node'
        const links = [...(this.linksFrom || []), ...(this.linksTo || [])]
        return `<div style="padding:10px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${this.name}</div>
          <div style="color:#6e6e73;">${role} · ${links.length} flows</div>
        </div>`
      },
      pointFormatter: function () {
        const custom = this.options.custom
        if (!custom) return ''
        const color = getInteractionBaseColor(custom.type)
        return `<div style="padding:12px;">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${custom.pair}</div>
          <div><span style="color:${color};font-weight:700;">&#9679;</span> ${custom.type}</div>
          <div style="margin-top:5px;">Type conservation: <b>${custom.conservation}%</b></div>
        </div>`
      }
    }
  }

  chart = Highcharts.chart(
    chartContainer.value,
    withExporting(chartOptions, `interaction-sankey-${systemsStore.currentSystem?.id || 'unknown'}`)
  )
}

onMounted(updateChart)
watch([
  () => chartUiStore.currentChartType,
  () => analysisStore.filteredInteractions.length,
  () => chartUiStore.currentThreshold,
  () => chartUiStore.selectedInteractionTypes.size,
  () => systemsStore.currentSystem?.id
], () => {
  if (chartUiStore.currentChartType === 'interactionSankey') updateChart()
}, { deep: true })
</script>

<style scoped>
.chart-wrapper { width: 100%; height: 100%; }
.chart-container { width: 100%; min-height: 760px; }
</style>
