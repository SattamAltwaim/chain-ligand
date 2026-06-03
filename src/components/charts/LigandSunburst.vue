<template>
  <div class="chart-wrapper">
    <div ref="chartContainer" class="chart-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import Highcharts from '../../utils/highchartsConfig'
import { withExporting } from '../../utils/highchartsConfig'
import SunburstModule from 'highcharts/modules/sunburst'
import { useAnalysisStore } from '../../stores/analysisStore'
import { useChartUiStore } from '../../stores/chartUiStore'
import { useSystemsStore } from '../../stores/systemsStore'
import { getInteractionBaseColor, getInteractionColorArray, formatResidueId } from '../../utils/chartHelpers'
import { INTERACTION_TYPES } from '../../utils/constants'

SunburstModule(Highcharts)

const analysisStore = useAnalysisStore()
const chartUiStore = useChartUiStore()
const systemsStore = useSystemsStore()
const chartContainer = ref(null)
let chart = null

/**
 * Build per-residue summaries from analysisStore.filteredInteractions.
 * Each interaction row has: resName1, resNum1, chain1, resName2, resNum2, chain2,
 *   frame, types, consistency, frameCount, typePersistence, ...
 * We group by chain2 residues (the "interacting" side) and compute per-residue stats.
 */
const residueSummary = computed(() => {
  const interactions = analysisStore.filteredInteractions
  if (!interactions.length) return []

  const totalFrames = systemsStore.totalFrames || 1
  const residueMap = new Map()

  for (const row of interactions) {
    // Use chain2 side (the protein residues) as the interacting partners
    const key = formatResidueId(row.resName2, row.resNum2, row.chain2)
    if (!key) continue

    if (!residueMap.has(key)) {
      residueMap.set(key, {
        resName: row.resName2,
        resNum: row.resNum2,
        chain: row.chain2,
        id: key,
        consistency: row.consistency || 0,
        frameCount: row.frameCount || 0,
        typeCounts: {}
      })
    }
    const entry = residueMap.get(key)
    // Track max consistency across all pairs involving this residue
    if ((row.consistency || 0) > entry.consistency) {
      entry.consistency = row.consistency
      entry.frameCount = row.frameCount || 0
    }
    // Count interaction types
    const types = (row.types || '').split(';').map(t => t.trim()).filter(Boolean)
    for (const t of types) {
      entry.typeCounts[t] = (entry.typeCounts[t] || 0) + 1
    }
  }

  return Array.from(residueMap.values()).map(entry => {
    let dominantType = ''
    let maxCount = 0
    for (const [type, count] of Object.entries(entry.typeCounts)) {
      if (count > maxCount) {
        maxCount = count
        dominantType = type
      }
    }
    return { ...entry, dominantType, allTypes: Object.keys(entry.typeCounts) }
  }).sort((a, b) => b.consistency - a.consistency)
})

const updateChart = () => {
  if (!chartContainer.value) return

  const residues = residueSummary.value
  if (!residues.length) {
    if (chart) { chart.destroy(); chart = null }
    chartContainer.value.innerHTML = '<div style="text-align:center;padding:100px 20px;color:#6e6e73;font-size:19px;">No residues above conservation threshold.</div>'
    return
  }

  const systemName = systemsStore.currentSystem?.name || 'System'
  const data = []

  // Root node
  data.push({
    id: 'root',
    name: systemName,
    parent: '',
    color: '#1d1d1f'
  })

  // Group residues by dominant interaction type
  const typeGroups = new Map()
  for (const res of residues) {
    const type = res.dominantType || 'Unknown'
    if (!typeGroups.has(type)) typeGroups.set(type, [])
    typeGroups.get(type).push(res)
  }

  // Sort groups by total consistency
  const sortedGroups = [...typeGroups.entries()].sort((a, b) => {
    const sumA = a[1].reduce((s, r) => s + r.consistency, 0)
    const sumB = b[1].reduce((s, r) => s + r.consistency, 0)
    return sumB - sumA
  })

  // Level 1: Interaction type rings
  for (const [type, groupResidues] of sortedGroups) {
    const colorArr = getInteractionColorArray(type)
    const typeId = `type_${type.replace(/[^a-zA-Z0-9]/g, '_')}`

    data.push({
      id: typeId,
      name: type,
      parent: 'root',
      color: `rgba(${colorArr[0]}, ${colorArr[1]}, ${colorArr[2]}, 0.55)`
    })

    // Level 2: Residues
    for (const res of groupResidues) {
      const conservationPct = Math.round(res.consistency * 100)
      const typeColor = getInteractionBaseColor(type)

      const typeLines = res.allTypes.map(t => {
        const c = getInteractionBaseColor(t)
        return `<span style="color:${c};font-weight:600;">&#9679;</span> ${t}`
      }).join('<br/>')

      data.push({
        id: `res_${res.id}`,
        name: `${res.resName}${res.resNum}`,
        parent: typeId,
        value: Math.max(1, conservationPct),
        color: typeColor,
        custom: {
          fullId: res.id,
          conservation: conservationPct,
          dominantType: res.dominantType,
          typeLines,
          frameCount: res.frameCount
        }
      })
    }
  }

  if (chart) chart.destroy()

  const chartOptions = {
    chart: {
      backgroundColor: 'transparent',
      height: 720
    },
    title: {
      text: `${systemName} — Ligand Interaction Sunburst`,
      style: { fontSize: '24px', fontWeight: '600', color: '#1d1d1f' }
    },
    subtitle: {
      text: `Center: system | Middle ring: interaction type | Outer ring: residues (arc = conservation)`,
      style: { fontSize: '14px', color: '#6e6e73' }
    },
    credits: { enabled: false },
    series: [{
      type: 'sunburst',
      data,
      name: 'Interactions',
      allowDrillToNode: true,
      borderRadius: 3,
      borderWidth: 2,
      borderColor: '#ffffff',
      cursor: 'pointer',
      dataLabels: {
        format: '{point.name}',
        filter: { property: 'innerArcLength', operator: '>', value: 16 },
        rotationMode: 'circular',
        style: {
          fontSize: '10px',
          fontWeight: '500',
          color: '#1d1d1f',
          textOutline: '2px rgba(255,255,255,0.8)'
        }
      },
      levels: [
        {
          level: 1,
          colorByPoint: true,
          dataLabels: {
            filter: { property: 'outerArcLength', operator: '>', value: 64 },
            style: { fontSize: '13px', fontWeight: '600', color: '#1d1d1f', textOutline: '2px rgba(255,255,255,0.9)' }
          }
        },
        {
          level: 2,
          colorByPoint: true,
          dataLabels: {
            rotationMode: 'circular',
            style: { fontSize: '11px', fontWeight: '600', color: '#1d1d1f', textOutline: '2px rgba(255,255,255,0.9)' }
          }
        },
        {
          level: 3,
          colorByPoint: false,
          dataLabels: {
            rotationMode: 'circular',
            style: { fontSize: '10px', fontWeight: '500', color: '#1d1d1f', textOutline: '2px rgba(255,255,255,0.8)' }
          }
        }
      ]
    }],
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.98)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#d2d2d7',
      useHTML: true,
      formatter: function () {
        const p = this.point
        if (p.id === 'root') {
          return `<div style="padding:10px"><b style="font-size:16px;">${p.name}</b><br/>${residues.length} interacting residues</div>`
        }
        if (p.id && p.id.startsWith('type_')) {
          const count = p.node.children ? p.node.children.length : 0
          return `<div style="padding:10px"><b style="font-size:15px;">${p.name}</b><br/>${count} residues</div>`
        }
        const c = p.options.custom
        if (!c) return `<div style="padding:10px"><b>${p.name}</b></div>`
        return `<div style="padding:12px;">
          <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${c.fullId}</div>
          <div style="margin-bottom:4px;">Conservation: <b>${c.conservation}%</b> (${c.frameCount}/${systemsStore.totalFrames} frames)</div>
          <div style="margin-bottom:4px;font-weight:600;border-top:1px solid #e8e8ed;padding-top:6px;">Interaction types:</div>
          ${c.typeLines}
        </div>`
      }
    }
  }

  chart = Highcharts.chart(chartContainer.value, withExporting(chartOptions, `ligand-sunburst-${systemsStore.currentSystem?.id || 'unknown'}`))
}

onMounted(updateChart)
watch([
  () => chartUiStore.currentChartType,
  () => analysisStore.filteredInteractions.length,
  () => chartUiStore.currentThreshold,
  () => systemsStore.currentSystem?.id
], () => {
  if (chartUiStore.currentChartType === 'ligandSunburst') updateChart()
}, { deep: true })
</script>

<style scoped>
.chart-wrapper { width: 100%; height: 100%; }
.chart-container { width: 100%; min-height: 720px; }
</style>
