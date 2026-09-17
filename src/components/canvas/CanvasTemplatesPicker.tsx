import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { TEMPLATES, TEMPLATE_CATEGORIES, type DiagramTemplate, type TemplateCategory } from './canvasTemplates'
import { cn } from '../../lib/utils'

// ── SVG previews ──────────────────────────────────────────────────────────────

function FlowchartPreview() {
  return (
    <svg viewBox="-110 -40 220 380" width="100%" height="100%" fill="none" stroke="currentColor">
      <defs><marker id="p-fc" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <ellipse cx="0" cy="0" rx="70" ry="26" strokeWidth="2"/>
      <text x="0" y="5" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">Start</text>
      <line x1="0" y1="28" x2="0" y2="70" strokeWidth="1.5" markerEnd="url(#p-fc)"/>
      <rect x="-80" y="72" width="160" height="48" rx="5" strokeWidth="1.5"/>
      <text x="0" y="100" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none">Step 1</text>
      <line x1="0" y1="122" x2="0" y2="164" strokeWidth="1.5" markerEnd="url(#p-fc)"/>
      <rect x="-80" y="166" width="160" height="48" rx="5" strokeWidth="1.5"/>
      <text x="0" y="194" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none">Step 2</text>
      <line x1="0" y1="216" x2="0" y2="258" strokeWidth="1.5" markerEnd="url(#p-fc)"/>
      <ellipse cx="0" cy="284" rx="70" ry="26" strokeWidth="2"/>
      <text x="0" y="289" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">End</text>
    </svg>
  )
}

function MindMapPreview() {
  return (
    <svg viewBox="-360 -130 720 260" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-90" y="-28" width="180" height="56" rx="8" strokeWidth="2"/>
      <text x="0" y="5" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">Main Topic</text>
      <line x1="-90" y1="-14" x2="-200" y2="-75" strokeWidth="1.5"/>
      <line x1="-90" y1="0"   x2="-200" y2="0"   strokeWidth="1.5"/>
      <line x1="-90" y1="14"  x2="-200" y2="75"  strokeWidth="1.5"/>
      <rect x="-310" y="-92" width="105" height="34" rx="5" strokeWidth="1.5"/>
      <text x="-258" y="-70" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Topic A</text>
      <rect x="-310" y="-17" width="105" height="34" rx="5" strokeWidth="1.5"/>
      <text x="-258" y="5"   textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Topic B</text>
      <rect x="-310" y="58"  width="105" height="34" rx="5" strokeWidth="1.5"/>
      <text x="-258" y="80"  textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Topic C</text>
      <line x1="90"  y1="-14" x2="200" y2="-75" strokeWidth="1.5"/>
      <line x1="90"  y1="0"   x2="200" y2="0"   strokeWidth="1.5"/>
      <line x1="90"  y1="14"  x2="200" y2="75"  strokeWidth="1.5"/>
      <rect x="205" y="-92" width="105" height="34" rx="5" strokeWidth="1.5"/>
      <text x="258" y="-70" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Topic D</text>
      <rect x="205" y="-17" width="105" height="34" rx="5" strokeWidth="1.5"/>
      <text x="258" y="5"   textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Topic E</text>
      <rect x="205" y="58"  width="105" height="34" rx="5" strokeWidth="1.5"/>
      <text x="258" y="80"  textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Topic F</text>
    </svg>
  )
}

function OrgChartPreview() {
  return (
    <svg viewBox="-280 -180 560 280" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-70" y="-170" width="140" height="44" rx="6" strokeWidth="2"/>
      <text x="0" y="-142" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">CEO</text>
      <line x1="0" y1="-126" x2="0" y2="-100" strokeWidth="1.5"/>
      <line x1="-140" y1="-100" x2="140" y2="-100" strokeWidth="1.5"/>
      <line x1="-140" y1="-100" x2="-140" y2="-78" strokeWidth="1.5"/>
      <line x1="140"  y1="-100" x2="140"  y2="-78" strokeWidth="1.5"/>
      <rect x="-210" y="-78" width="140" height="44" rx="5" strokeWidth="1.5"/>
      <text x="-140" y="-50" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Manager A</text>
      <rect x="70" y="-78" width="140" height="44" rx="5" strokeWidth="1.5"/>
      <text x="140" y="-50" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Manager B</text>
      <line x1="-140" y1="-34" x2="-140" y2="-12" strokeWidth="1.2"/>
      <line x1="-190" y1="-12" x2="-90" y2="-12" strokeWidth="1.2"/>
      <line x1="-190" y1="-12" x2="-190" y2="6" strokeWidth="1.2"/>
      <line x1="-90"  y1="-12" x2="-90"  y2="6" strokeWidth="1.2"/>
      <rect x="-240" y="6" width="100" height="36" rx="4" strokeWidth="1.2"/>
      <text x="-190" y="29" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Report 1</text>
      <rect x="-140" y="6" width="100" height="36" rx="4" strokeWidth="1.2"/>
      <text x="-90" y="29" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Report 2</text>
      <line x1="140" y1="-34" x2="140" y2="6" strokeWidth="1.2"/>
      <rect x="90" y="6" width="100" height="36" rx="4" strokeWidth="1.2"/>
      <text x="140" y="29" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Report 3</text>
    </svg>
  )
}

function SequencePreview() {
  return (
    <svg viewBox="-260 -150 520 380" width="100%" height="100%" fill="none" stroke="currentColor">
      <defs><marker id="p-sq" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <rect x="-240" y="-140" width="120" height="44" rx="5" strokeWidth="2"/>
      <text x="-180" y="-112" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">Actor A</text>
      <rect x="120" y="-140" width="120" height="44" rx="5" strokeWidth="2"/>
      <text x="180" y="-112" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">Actor B</text>
      <line x1="-180" y1="-96" x2="-180" y2="210" strokeWidth="1"/>
      <line x1="180"  y1="-96" x2="180"  y2="210" strokeWidth="1"/>
      <line x1="-180" y1="-30" x2="175" y2="-30" strokeWidth="1.5" markerEnd="url(#p-sq)"/>
      <text x="-10" y="-38" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Request</text>
      <line x1="180" y1="50" x2="-175" y2="50" strokeWidth="1.5" markerEnd="url(#p-sq)"/>
      <text x="-10" y="42" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Response</text>
      <line x1="-180" y1="130" x2="175" y2="130" strokeWidth="1.5" markerEnd="url(#p-sq)"/>
      <text x="-10" y="122" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Callback</text>
    </svg>
  )
}

function TimelinePreview() {
  return (
    <svg viewBox="-260 -100 520 200" width="100%" height="100%" fill="none" stroke="currentColor">
      <defs><marker id="p-tl" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <line x1="-250" y1="0" x2="248" y2="0" strokeWidth="2" markerEnd="url(#p-tl)"/>
      {[{ x: -200, l: 'Phase 1', a: true }, { x: -65, l: 'Phase 2', a: false }, { x: 65, l: 'Phase 3', a: true }, { x: 200, l: 'Phase 4', a: false }].map(({ x, l, a }) => (
        <g key={x}>
          <line x1={x} y1="-10" x2={x} y2="10" strokeWidth="1.5"/>
          <line x1={x} y1={a ? -10 : 10} x2={x} y2={a ? -38 : 38} strokeWidth="1.2"/>
          <text x={x} y={a ? -44 : 52} textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontWeight="600">{l}</text>
        </g>
      ))}
    </svg>
  )
}

function VennPreview() {
  return (
    <svg viewBox="-260 -150 520 300" width="100%" height="100%" fill="none" stroke="currentColor">
      <ellipse cx="-65" cy="0" rx="160" ry="120" strokeWidth="2"/>
      <ellipse cx="65"  cy="0" rx="160" ry="120" strokeWidth="2"/>
      <text x="-150" y="5" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">Set A</text>
      <text x="150"  y="5" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">Set B</text>
      <text x="0"    y="5" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Both</text>
    </svg>
  )
}

function ERPreview() {
  return (
    <svg viewBox="-350 -160 700 220" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-340" y="-140" width="175" height="34" rx="5" strokeWidth="2"/>
      <text x="-252" y="-117" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">User</text>
      <rect x="-340" y="-106" width="175" height="95" rx="5" strokeWidth="1.2"/>
      {['PK  id : INT','name : VARCHAR','email : VARCHAR','created_at'].map((t, i) => (
        <text key={t} x="-328" y={-106 + 22 + i * 22} fontSize="9" fill="currentColor" stroke="none">{t}</text>
      ))}
      <rect x="80" y="-140" width="175" height="34" rx="5" strokeWidth="2"/>
      <text x="168" y="-117" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">Order</text>
      <rect x="80" y="-106" width="175" height="95" rx="5" strokeWidth="1.2"/>
      {['PK  id : INT','FK  user_id','total : DECIMAL','status'].map((t, i) => (
        <text key={t} x="92" y={-106 + 22 + i * 22} fontSize="9" fill="currentColor" stroke="none">{t}</text>
      ))}
      <line x1="-165" y1="-88" x2="80" y2="-88" strokeWidth="1.5"/>
      <text x="-160" y="-94" fontSize="9" fill="currentColor" stroke="none">1</text>
      <text x="64"   y="-94" fontSize="9" fill="currentColor" stroke="none">N</text>
      <text x="-60"  y="-94" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">places</text>
    </svg>
  )
}

function SchemaPreview() {
  const rows = [['id','INT','PK'],['username','VARCHAR','NOT NULL'],['email','VARCHAR','UNIQUE'],['role','ENUM','DEFAULT'],['created_at','TIMESTAMP','NOW()']]
  return (
    <svg viewBox="-230 -170 460 260" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-220" y="-160" width="440" height="34" rx="5" strokeWidth="2"/>
      <text x="-210" y="-137" fontSize="12" fill="currentColor" stroke="none" fontWeight="600">users</text>
      <rect x="-220" y="-126" width="440" height="28" rx="0" strokeWidth="1.2"/>
      {['Column','Type','Constraints'].map((h, i) => (
        <text key={h} x={-210 + i * 148} y="-107" fontSize="9" fill="currentColor" stroke="none" fontWeight="600">{h}</text>
      ))}
      {rows.map((row, ri) => (
        <g key={ri}>
          <rect x="-220" y={-98 + ri * 26} width="440" height="26" rx="0" strokeWidth="0.7"/>
          {row.map((cell, ci) => (
            <text key={ci} x={-210 + ci * 148} y={-98 + ri * 26 + 17} fontSize="9" fill="currentColor" stroke="none" fontWeight={ci === 0 ? '600' : '400'}>{cell}</text>
          ))}
        </g>
      ))}
    </svg>
  )
}

function DataFlowPreview() {
  return (
    <svg viewBox="-350 -80 700 220" width="100%" height="100%" fill="none" stroke="currentColor">
      <defs><marker id="p-df" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <rect x="-330" y="-40" width="110" height="60" rx="6" strokeWidth="2"/>
      <text x="-275" y="-5" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">Client</text>
      <line x1="-220" y1="-10" x2="-145" y2="-10" strokeWidth="1.5" markerEnd="url(#p-df)"/>
      <ellipse cx="-60" cy="-10" rx="80" ry="36" strokeWidth="2"/>
      <text x="-60" y="-14" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none" fontWeight="600">API</text>
      <text x="-60" y="4"  textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Handler</text>
      <line x1="20" y1="-10" x2="95" y2="-10" strokeWidth="1.5" markerEnd="url(#p-df)"/>
      <line x1="100" y1="-36" x2="260" y2="-36" strokeWidth="2"/>
      <line x1="100" y1="16"  x2="260" y2="16"  strokeWidth="2"/>
      <line x1="100" y1="-36" x2="100" y2="16"  strokeWidth="1.2"/>
      <text x="120" y="-6" fontSize="9" fill="currentColor" stroke="none">D1 · Database</text>
      <line x1="-60" y1="26" x2="-60" y2="80" strokeWidth="1.2" markerEnd="url(#p-df)"/>
      <line x1="-150" y1="80" x2="30" y2="80"  strokeWidth="2"/>
      <line x1="-150" y1="118" x2="30" y2="118" strokeWidth="2"/>
      <line x1="-150" y1="80"  x2="-150" y2="118" strokeWidth="1.2"/>
      <text x="-140" y="104" fontSize="9" fill="currentColor" stroke="none">D2 · Redis Cache</text>
    </svg>
  )
}

function SystemDesignPreview() {
  return (
    <svg viewBox="-430 -80 760 200" width="100%" height="100%" fill="none" stroke="currentColor">
      <defs><marker id="p-sd" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="currentColor"/></marker></defs>
      <rect x="-420" y="-36" width="100" height="66" rx="6" strokeWidth="2"/>
      <text x="-370" y="-3" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none" fontWeight="600">Browser</text>
      <line x1="-320" y1="0" x2="-258" y2="0" strokeWidth="1.5" markerEnd="url(#p-sd)"/>
      <rect x="-258" y="-36" width="110" height="66" rx="6" strokeWidth="2"/>
      <text x="-203" y="-5" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontWeight="600">Load</text>
      <text x="-203" y="12" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontWeight="600">Balancer</text>
      <line x1="-148" y1="0" x2="-108" y2="0" strokeWidth="1.2"/>
      <line x1="-108" y1="-50" x2="-108" y2="50" strokeWidth="1.2"/>
      <line x1="-108" y1="-50" x2="-50" y2="-50" strokeWidth="1.2" markerEnd="url(#p-sd)"/>
      <line x1="-108" y1="50"  x2="-50" y2="50"  strokeWidth="1.2" markerEnd="url(#p-sd)"/>
      <rect x="-50" y="-74" width="118" height="48" rx="5" strokeWidth="1.2"/>
      <text x="14" y="-44" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">API Server 1</text>
      <rect x="-50" y="26"  width="118" height="48" rx="5" strokeWidth="1.2"/>
      <text x="14" y="55"  textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">API Server 2</text>
      <line x1="68" y1="-50" x2="110" y2="-50" strokeWidth="1.2"/>
      <line x1="68" y1="50"  x2="110" y2="50"  strokeWidth="1.2"/>
      <line x1="110" y1="-50" x2="110" y2="50"  strokeWidth="1.2"/>
      <line x1="110" y1="0"  x2="148" y2="0"   strokeWidth="1.2" markerEnd="url(#p-sd)"/>
      <rect x="148" y="-46" width="120" height="92" rx="6" strokeWidth="2"/>
      <ellipse cx="208" cy="-46" rx="60" ry="14" strokeWidth="1.2"/>
      <text x="208" y="14" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none" fontWeight="600">PostgreSQL</text>
    </svg>
  )
}

function ComponentTreePreview() {
  return (
    <svg viewBox="-380 -220 760 320" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-60" y="-210" width="120" height="36" rx="7" strokeWidth="2"/>
      <text x="0" y="-186" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none" fontWeight="600">&lt;App /&gt;</text>
      <line x1="0" y1="-174" x2="0" y2="-154"/>
      <line x1="-180" y1="-154" x2="180" y2="-154"/>
      {[-180, 0, 180].map(x => <line key={x} x1={x} y1="-154" x2={x} y2="-136" strokeWidth="1.2"/>)}
      {[{ x: -180, l: '<Router />' }, { x: 0, l: '<Layout />' }, { x: 180, l: '<Providers />' }].map(({ x, l }) => (
        <g key={x}>
          <rect x={x - 55} y="-136" width="110" height="32" rx="6" strokeWidth="1.2"/>
          <text x={x} y="-114" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">{l}</text>
        </g>
      ))}
      <line x1="0" y1="-104" x2="0" y2="-84"/>
      <line x1="-120" y1="-84" x2="120" y2="-84"/>
      {[-120, 0, 120].map(x => <line key={x} x1={x} y1="-84" x2={x} y2="-66" strokeWidth="1.2"/>)}
      {[{ x: -120, l: '<NavBar />' }, { x: 0, l: '<Page />' }, { x: 120, l: '<Footer />' }].map(({ x, l }) => (
        <g key={x}>
          <rect x={x - 50} y="-66" width="100" height="28" rx="5" strokeWidth="1"/>
          <text x={x} y="-46" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">{l}</text>
        </g>
      ))}
      <line x1="0" y1="-38" x2="0" y2="-18"/>
      <line x1="-70" y1="-18" x2="70" y2="-18"/>
      {[-70, 70].map(x => <line key={x} x1={x} y1="-18" x2={x} y2="0" strokeWidth="1"/>)}
      {[{ x: -70, l: '<Hero />' }, { x: 70, l: '<Cards />' }].map(({ x, l }) => (
        <g key={x}>
          <rect x={x - 45} y="0" width="90" height="26" rx="4" strokeWidth="1"/>
          <text x={x} y="17" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">{l}</text>
        </g>
      ))}
    </svg>
  )
}

function APIFlowPreview() {
  const steps = ['HTTP Request', 'Auth Middleware', 'Rate Limiter', 'Route Handler', 'DB Query', 'HTTP Response']
  return (
    <svg viewBox="-180 -230 360 460" width="100%" height="100%" fill="none" stroke="currentColor">
      <defs><marker id="p-af" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0,0 L4,3 L0,6 Z" fill="currentColor"/></marker></defs>
      {steps.map((label, i) => {
        const y = -200 + i * 74
        const edge = i === 0 || i === 5
        return (
          <g key={label}>
            <rect x="-160" y={y} width="320" height="48" rx="9" strokeWidth={edge ? 2 : 1.2}/>
            <text x="0" y={y + 27} textAnchor="middle" fontSize="10" fill="currentColor" stroke="none" fontWeight={edge ? '600' : '400'}>{label}</text>
            {i < 5 && <line x1="0" y1={y + 48} x2="0" y2={y + 74} strokeWidth="1.2" markerEnd="url(#p-af)"/>}
          </g>
        )
      })}
    </svg>
  )
}

function BrainstormPreview() {
  const nodes = [{ cx: -200, cy: -120, l: 'Concept A' }, { cx: 60, cy: -140, l: 'Concept B' }, { cx: 190, cy: 10, l: 'Concept C' }, { cx: 80, cy: 140, l: 'Concept D' }, { cx: -190, cy: 120, l: 'Concept E' }, { cx: -280, cy: 10, l: 'Concept F' }]
  return (
    <svg viewBox="-320 -180 640 360" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-80" y="-30" width="160" height="60" rx="30" strokeWidth="2"/>
      <text x="0" y="5" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">Central Idea</text>
      {nodes.map(({ cx, cy, l }) => {
        const angle = Math.atan2(cy, cx)
        return (
          <g key={l}>
            <line x1={Math.cos(angle)*80} y1={Math.sin(angle)*30} x2={cx - Math.cos(angle)*65} y2={cy - Math.sin(angle)*26} strokeWidth="1"/>
            <ellipse cx={cx} cy={cy} rx="65" ry="26" strokeWidth="1.2"/>
            <text x={cx} y={cy + 5} textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">{l}</text>
          </g>
        )
      })}
    </svg>
  )
}

function UIFramePreview() {
  return (
    <svg viewBox="-170 -310 340 620" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-155" y="-300" width="310" height="590" rx="28" strokeWidth="2"/>
      <line x1="-155" y1="-256" x2="155" y2="-256" strokeWidth="0.5"/>
      <text x="-100" y="-264" fontSize="8" fill="currentColor" stroke="none">9:41</text>
      <rect x="-155" y="-256" width="310" height="50" rx="0" strokeWidth="0.5"/>
      <text x="0" y="-224" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none" fontWeight="600">Home</text>
      {[0, 1, 2].map(i => {
        const y = -196 + i * 116
        return (
          <g key={i}>
            <rect x="-135" y={y} width="270" height="96" rx="10" strokeWidth="1.2"/>
            <rect x="-125" y={y + 8} width="60" height="50" rx="6" strokeWidth="0.7"/>
            <text x="-50" y={y + 30} fontSize="9" fill="currentColor" stroke="none" fontWeight="600">Item {i + 1}</text>
            <text x="-50" y={y + 48} fontSize="8" fill="currentColor" stroke="none">Description…</text>
          </g>
        )
      })}
      <line x1="-155" y1="160" x2="155" y2="160" strokeWidth="0.5"/>
      <text x="-90"  y="195" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">Home</text>
      <text x="0"    y="195" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">Search</text>
      <text x="90"   y="195" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">Profile</text>
    </svg>
  )
}

function ButtonStatesPreview() {
  return (
    <svg viewBox="-320 -120 640 280" width="100%" height="100%" fill="none" stroke="currentColor">
      <text x="0" y="-88" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">Button States</text>
      {[{ x: -200, l: 'Default', w: 2 }, { x: 0, l: 'Primary', w: 1.2 }, { x: 200, l: 'Disabled', w: 0.7 }].map(({ x, l, w }) => (
        <g key={l}>
          <rect x={x - 80} y="-60" width="160" height="52" rx="12" strokeWidth={l === 'Primary' ? 2 : w}/>
          <text x={x} y="-27" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight={l === 'Primary' ? '600' : '400'}>{l}</text>
        </g>
      ))}
      {[{ x: -200, l: 'Small', w: 100, h: 32, r: 8 }, { x: 0, l: 'Medium', w: 130, h: 44, r: 10 }, { x: 200, l: 'Large', w: 158, h: 54, r: 12 }].map(({ x, l, w, h, r }) => (
        <g key={l}>
          <rect x={x - w/2} y="30" width={w} height={h} rx={r} strokeWidth="1.2"/>
          <text x={x} y={30 + h/2 + 4} textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">{l}</text>
        </g>
      ))}
    </svg>
  )
}

function InputFormPreview() {
  return (
    <svg viewBox="-200 -280 400 560" width="100%" height="100%" fill="none" stroke="currentColor">
      <text x="0" y="-244" textAnchor="middle" fontSize="13" fill="currentColor" stroke="none" fontWeight="600">Create Account</text>
      {[{ l: 'Full Name', y: -210 }, { l: 'Email', y: -110 }, { l: 'Password', y: -10 }].map(({ l, y }) => (
        <g key={l}>
          <text x="-170" y={y - 8} fontSize="9" fill="currentColor" stroke="none">{l}</text>
          <rect x="-170" y={y} width="340" height="50" rx="9" strokeWidth="1.2"/>
        </g>
      ))}
      <rect x="-170" y="100" width="340" height="52" rx="11" strokeWidth="2"/>
      <text x="0" y="132" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none" fontWeight="600">Create Account</text>
      <line x1="-170" y1="172" x2="-30" y2="172" strokeWidth="0.5"/>
      <line x1="30"   y1="172" x2="170" y2="172" strokeWidth="0.5"/>
      <text x="0" y="177" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">or</text>
      <rect x="-170" y="182" width="340" height="50" rx="9" strokeWidth="1.2"/>
      <text x="0" y="213" textAnchor="middle" fontSize="10" fill="currentColor" stroke="none">Continue with Google</text>
    </svg>
  )
}

function CardPreview() {
  return (
    <svg viewBox="-210 -270 420 540" width="100%" height="100%" fill="none" stroke="currentColor">
      <rect x="-200" y="-260" width="400" height="510" rx="18" strokeWidth="2"/>
      <rect x="-200" y="-260" width="400" height="190" rx="18" strokeWidth="1"/>
      <line x1="-200" y1="-260" x2="200" y2="-70" strokeWidth="0.4"/>
      <line x1="200"  y1="-260" x2="-200" y2="-70" strokeWidth="0.4"/>
      <text x="0" y="-160" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none">Image</text>
      <rect x="-180" y="-56" width="88" height="26" rx="13" strokeWidth="1"/>
      <text x="-136" y="-37" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none">Featured</text>
      <text x="-180" y="-2" fontSize="13" fill="currentColor" stroke="none" fontWeight="600">Card Title</text>
      <text x="-180" y="24" fontSize="9" fill="currentColor" stroke="none">Short description of the</text>
      <text x="-180" y="40" fontSize="9" fill="currentColor" stroke="none">card content goes here.</text>
      <line x1="-180" y1="60" x2="180" y2="60" strokeWidth="0.5"/>
      <rect x="-180" y="72" width="175" height="42" rx="9" strokeWidth="1.2"/>
      <text x="-92"  y="98" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Read More →</text>
      <rect x="4"    y="72" width="175" height="42" rx="9" strokeWidth="2"/>
      <text x="92"   y="98" textAnchor="middle" fontSize="9" fill="currentColor" stroke="none">Save</text>
    </svg>
  )
}

const PREVIEWS: Record<string, React.FC> = {
  flowchart:  FlowchartPreview,
  mindmap:    MindMapPreview,
  orgchart:   OrgChartPreview,
  sequence:   SequencePreview,
  timeline:   TimelinePreview,
  venn:       VennPreview,
  er:         ERPreview,
  schema:     SchemaPreview,
  dataflow:   DataFlowPreview,
  sysdesign:  SystemDesignPreview,
  comptree:   ComponentTreePreview,
  apiflow:    APIFlowPreview,
  brainstorm: BrainstormPreview,
  uiframe:    UIFramePreview,
  buttons:    ButtonStatesPreview,
  form:       InputFormPreview,
  card:       CardPreview,
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({ tpl, onSelect }: { tpl: DiagramTemplate; onSelect: () => void }) {
  const Preview = PREVIEWS[tpl.id]
  return (
    <button
      onClick={onSelect}
      className="flex flex-col gap-2 p-2.5 rounded-xl border border-border bg-background hover:bg-surface hover:border-border transition-all group text-left"
    >
      <div className="w-full aspect-[4/3] rounded-lg bg-accent/8 border border-accent/15 flex items-center justify-center text-accent/70 group-hover:text-accent transition-colors overflow-hidden p-1.5">
        {Preview && <Preview />}
      </div>
      <div className="px-0.5">
        <p className="text-xs font-semibold text-foreground leading-tight">{tpl.name}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{tpl.description}</p>
      </div>
    </button>
  )
}

// ── Picker modal ──────────────────────────────────────────────────────────────

interface Props {
  onSelect: (tpl: DiagramTemplate) => void
  onClose:  () => void
}

export function CanvasTemplatesPicker({ onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('diagrams')

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = TEMPLATES.filter(t => t.category === activeCategory)

  return (
    /* Overlay */
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div
        ref={ref}
        className="bg-panel border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 680, maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div>
            <p className="text-sm font-semibold text-foreground">Templates</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Pick a template to add to the canvas</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-3 px-5 pb-3 flex-shrink-0 border-b border-border">
          <div className="flex items-center gap-1 border border-border rounded-lg p-1">
            {TEMPLATE_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs transition-colors',
                  activeCategory === cat.id
                    ? 'bg-active text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[10px] text-tertiary self-center">
            {filtered.length} template{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Grid */}
        <div className="overflow-y-auto p-4">
          <div className="grid grid-cols-4 gap-3">
            {filtered.map(tpl => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                onSelect={() => { onSelect(tpl); onClose() }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
