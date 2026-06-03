/**
 * Static data service — replaces the Flask backend for ChainLigand demo.
 * Reads CSV/JSON files from /data/ and returns the same payload shapes
 * the COCOMAPS-MD frontend expects.
 */

const SYSTEM_ID = 'chainligand-demo'

function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const values = line.split(',')
    const obj = {}
    headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim() })
    return obj
  })
}

function formatResidueId(resName, resNum, chain) {
  if (!resName || !resNum || !chain) return ''
  return `${resName.trim()}${parseInt(resNum)}_${chain.trim()}`
}

let _cache = {}

async function fetchText(path) {
  if (_cache[path]) return _cache[path]
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`)
  const text = await res.text()
  _cache[path] = text
  return text
}

async function fetchJSON(path) {
  const text = await fetchText(path)
  return JSON.parse(text)
}

export default {
  // Systems — return a single static system
  async getSystems() {
    const meta = await fetchJSON('/data/_metadata.json')
    return [{
      id: SYSTEM_ID,
      name: meta.systemName || 'ChainLigand Demo',
      frames: meta.totalFrames || 0,
      chain1: 'A',
      chain2: 'B',
      jobId: meta.jobId || SYSTEM_ID
    }]
  },

  async getSystem(systemId) {
    const meta = await fetchJSON('/data/_metadata.json')
    return {
      id: SYSTEM_ID,
      name: meta.systemName || 'ChainLigand Demo',
      frames: meta.totalFrames || 0,
      chain1: 'A',
      chain2: 'B',
      jobId: meta.jobId || SYSTEM_ID
    }
  },

  async renameSystem() { return { success: true } },

  // Interactions — parse _interactions.csv exactly like the Flask backend
  async getInteractions(systemId) {
    const meta = await fetchJSON('/data/_metadata.json')
    const totalFrames = meta.totalFrames || 1
    const text = await fetchText('/data/_interactions.csv')
    const rows = parseCSV(text)

    const interactionMap = {}
    for (const row of rows) {
      const resId1 = formatResidueId(row.resName1, row.resNum1, row.chain1)
      const resId2 = formatResidueId(row.resName2, row.resNum2, row.chain2)
      const key = `${resId1}__${resId2}`
      const frame = parseInt(row.frame)

      if (!interactionMap[key]) {
        interactionMap[key] = {
          resName1: row.resName1,
          resNum1: parseInt(row.resNum1),
          chain1: row.chain1,
          resName2: row.resName2,
          resNum2: parseInt(row.resNum2),
          chain2: row.chain2,
          frames: [],
          types: new Set(),
          typeFrames: {}
        }
      }
      const entry = interactionMap[key]
      entry.frames.push(frame)
      for (const t of (row.types || '').split(';').map(s => s.trim()).filter(Boolean)) {
        entry.types.add(t)
        if (!entry.typeFrames[t]) entry.typeFrames[t] = []
        entry.typeFrames[t].push(frame)
      }
    }

    const interactions = Object.values(interactionMap).map(entry => {
      const frameSet = [...new Set(entry.frames)]
      const typesArray = [...entry.types]
      const typePersistence = {}
      const typeFramesMap = {}
      for (const t of typesArray) {
        const uniqueFrames = [...new Set(entry.typeFrames[t] || [])]
        typePersistence[t] = uniqueFrames.length / totalFrames
        typeFramesMap[t] = uniqueFrames.sort((a, b) => a - b)
      }
      return {
        resName1: entry.resName1,
        resNum1: entry.resNum1,
        chain1: entry.chain1,
        id1: formatResidueId(entry.resName1, entry.resNum1, entry.chain1),
        resName2: entry.resName2,
        resNum2: entry.resNum2,
        chain2: entry.chain2,
        id2: formatResidueId(entry.resName2, entry.resNum2, entry.chain2),
        frameCount: frameSet.length,
        consistency: frameSet.length / totalFrames,
        types: typesArray.join('; '),
        typesArray,
        typePersistence,
        frames: frameSet.sort((a, b) => a - b),
        typeFrames: typeFramesMap
      }
    })
    interactions.sort((a, b) => b.consistency - a.consistency)

    return {
      system: systemId,
      totalFrames,
      interactions
    }
  },

  // Area data — parse _area.csv
  async getAreaData(systemId) {
    const text = await fetchText('/data/_area.csv')
    const rows = parseCSV(text)
    const frames = rows.map(row => ({
      frame: parseInt(row.frame),
      totalBSA: parseFloat(row.totalBSA),
      polarBSA: parseFloat(row.polarBSA),
      nonPolarBSA: parseFloat(row.nonPolarBSA),
      totalPercent: parseFloat(row.totalPercent),
      polarPercent: parseFloat(row.polarPercent),
      nonPolarPercent: parseFloat(row.nonPolarPercent)
    }))
    return { system: systemId, frames }
  },

  // Trends — parse _trends.csv
  async getTrends(systemId) {
    const text = await fetchText('/data/_trends.csv')
    const rows = parseCSV(text)
    if (!rows.length) return { system: systemId, trends: {}, frameNumbers: [] }

    const frameNumbers = rows.map(r => parseInt(r.frame))
    const trends = {}
    const headers = Object.keys(rows[0]).filter(h => h !== 'frame')
    for (const h of headers) {
      trends[h] = rows.map(r => parseInt(r[h]) || 0)
    }
    return { system: systemId, trends, frameNumbers }
  },

  // Stubs for features not applicable to static demo
  async getAtomPairs() { return { pairs: [] } },
  async getAtomPairsBatch() { return { pairs: [] } },
  async getInteractionDistances() { return { pairs: [] } },
  async getConservedIslands() { return { islands: [] } },
  getFramePdbUrl() { return '' },
  async getFramePdbContent() { return '' },
  async getDistanceDistributions() { return { distributions: [] } },
  async uploadFile() { return { error: 'Upload not supported in static mode' } },
  async uploadFileWithOptions() { return { error: 'Upload not supported in static mode' } },
  async getStatus() { return { status: 'complete' } },
  async getJobs() { return [] }
}
