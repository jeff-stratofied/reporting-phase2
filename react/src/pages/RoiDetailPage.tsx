import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePortfolio } from '../hooks/usePortfolio'
import RoiChart from '../components/RoiChart'
import type { LoanSeries } from '../components/RoiChart'
import LoanTable from '../components/LoanTable'
import SharedLoanDrawer from '../components/LoanDrawer'
import SharedKpiDrawer from '../components/KpiDrawer'
import { useUser } from '../context/UserContext'

type RoiKpiKey = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4'
type DrawerMode = { kind: 'kpi'; kpi: RoiKpiKey } | { kind: 'loan'; loanId: string } | null

const fmt   = (v: number, d = 2) => v.toFixed(d) + '%'
const fmt$  = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMY = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const TODAY = new Date()
const KPI_CURRENT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)

const filterSelectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#0f172a',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const filterBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#0f172a',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

// ─── Shared table styles inside drawers ───────────────────────────────────────
const drawerThStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', color: '#94a3b8', fontWeight: 700,
  fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, background: '#f8fafc',
}
const drawerThR: React.CSSProperties = { ...drawerThStyle, textAlign: 'right' }

// ─── DrawerShell — fixed full-height overlay ─────────────────────────────────
/* delete
function DrawerShell({ open, title, subTitle, onClose, children }: {
  open: boolean
  title: string
  subTitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <>
      {
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 89,
          background: 'transparent',
          cursor: 'default',
        }}
      />
      <div style={{
        position: 'fixed',
        right: 0,
        top: 0,
        height: '100vh',
        width: 580,
      background: '#fff',
      borderLeft: '1px solid #e2e8f0',
      boxShadow: '-28px 0 80px rgba(15,23,42,0.14)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 90,
      animation: 'drawerSlideIn 0.22s cubic-bezier(0.25, 1, 0.5, 1) both',
    }}>
    <style>{`
      @keyframes drawerSlideIn {
        from { transform: translateX(100%); }
        to   { transform: translateX(0); }
      }
    `}</style>
      
      <div style={{
        padding: '20px 20px 14px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        borderBottom: '1px solid #e2e8f0', flexShrink: 0, background: '#fff',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
          {subTitle && <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>{subTitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#0f172a' }}>
            Download CSV
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1, padding: '2px 6px', borderRadius: 6 }}>
            ✕
          </button>
        </div>
      </div>

      
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>

      
      <div style={{ padding: '10px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, background: '#fff', flexShrink: 0 }}>
        <button style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#0f172a' }} onClick={() => window.print()}>
          Print
        </button>
        <button style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#0ea5e9', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#fff' }}>
          Copy CSV
        </button>
      </div>
    </div>
    </>
  )
}
*/

// ─── Stat bar (2 cards) ───────────────────────────────────────────────────────
function StatBar({ primaryLabel, primaryValue, secondaryLabel, secondaryValue }: {
  primaryLabel: string; primaryValue: string; secondaryLabel: string; secondaryValue: string
}) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1, background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{primaryLabel}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{primaryValue}</div>
      </div>
      <div style={{ width: 190, background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{secondaryLabel}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{secondaryValue}</div>
      </div>
    </div>
  )
}

// ─── Chart wrapper ────────────────────────────────────────────────────────────
function ChartBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'linear-gradient(180deg,#fff,#fcfeff)', borderRadius: 8, border: '1px solid rgba(15,23,42,0.06)', boxShadow: '0 6px 18px rgba(15,23,42,0.06)', padding: 8 }}>
      {children}
    </div>
  )
}

// ─── Individual Loan Drawer ───────────────────────────────────────────────────
function LoanDrawerBody({ loan }: { loan: any }) {
  const color = loan.color ?? loan.loanColor ?? '#0ea5e9'
  const roiSeries: { date: Date; roi: number; loanValue: number }[] = loan.roiSeries ?? []

  const singleSeries: LoanSeries[] = useMemo(() => [{
    id: String(loan.loanId ?? loan.id ?? ''),
    name: loan.loanName ?? loan.name ?? '',
    color,
    data: roiSeries.map(s => ({
      date: s.date instanceof Date ? s.date : new Date(s.date),
      y: s.roi,
    })),
  }], [loan, roiSeries, color])

  const chartDates = useMemo(() =>
    roiSeries.map(s => s.date instanceof Date ? s.date : new Date(s.date)),
  [roiSeries])

  const origAmt = Number(loan.originalLoanAmount ?? loan.origLoanAmt ?? loan.loanAmount ?? loan.principal ?? 0)
  const rate = (() => { const r = Number(loan.nominalRate ?? 0); return r < 1 ? r * 100 : r })()
  const purchasePrice = Number(loan.purchasePrice ?? loan.userPurchasePrice ?? 0)

  return (
    <>
      <ChartBox>
        <RoiChart
          perLoanSeries={singleSeries}
          weightedSeries={[]}
          dates={chartDates}
          height={240}
          tickSpacingX={Math.max(1, Math.round(chartDates.length / 8))}
          weightedColor={color}
          weightedWidth={0}
          weightedLabel=""
          focusedLoanId={null}
          onFocusLoan={() => {}}
        />
      </ChartBox>

      <StatBar
        primaryLabel="Orig Loan Amount"
        primaryValue={fmt$(origAmt)}
        secondaryLabel="Nominal Rate"
        secondaryValue={rate.toFixed(2) + '%'}
      />

      {/* ROI by Month table */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>ROI by Month</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '45vh', overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={drawerThStyle}>Month</th>
                <th style={drawerThR}>Balance</th>
                <th style={drawerThR}>Loan Value</th>
                <th style={drawerThR}>ROI</th>
              </tr>
            </thead>
            <tbody>
              {roiSeries.map((s, i) => {
                const d = s.date instanceof Date ? s.date : new Date(s.date)
                const sched = loan.amort?.schedule ?? []
                const row = sched.find((r: any) =>
                  r.loanDate instanceof Date &&
                  r.loanDate.getFullYear() === d.getFullYear() &&
                  r.loanDate.getMonth() === d.getMonth()
                ) ?? {}
                const roiPct = (s.roi ?? 0) * 100

                // Event row highlighting — prepay overrides deferral
                const rowKey = d.getFullYear() * 12 + d.getMonth()
                const isPrepayMonth = (loan.events ?? []).some((e: any) => {
                  if (e.type !== 'prepayment' || !e.date) return false
                  const ed = e.date instanceof Date ? e.date : new Date(e.date)
                  return !isNaN(+ed) && ed.getFullYear() * 12 + ed.getMonth() === rowKey
                })
                const eventBg = isPrepayMonth
                  ? 'rgba(22,163,74,0.12)'          // green — prepay (overrides deferral)
                  : row.isTerminal === true
                    ? 'rgba(220,38,38,0.10)'         // red — default
                    : row.isOwned && row.isDeferred === true
                      ? 'rgba(234,179,8,0.13)'       // yellow — deferral
                      : i % 2 === 1 ? 'rgba(15,23,42,0.015)' : 'transparent'

                return (
                  <tr key={i} style={{ background: eventBg }}>
                    <td style={{ padding: '7px 10px', textAlign: 'left', color: '#0f172a' }}>{fmtMY(d)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{row.balance != null ? fmt$(row.balance) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{s.loanValue != null ? fmt$(s.loanValue) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: roiPct >= 0 ? '#16a34a' : '#dc2626' }}>{roiPct.toFixed(2)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── KPI Drawer tables ────────────────────────────────────────────────────────
function KpiTable({ loans, mode, focusedLoanId, onFocusLoan, colorById }: {
  loans: any[]; mode: 'roi-date' | 'projected' | 'capital' | 'spread';
  focusedLoanId: string | null; onFocusLoan: (id: string | null) => void;
  colorById?: Record<string, string>
}) {
  const headers = {
    'roi-date':  ['Loan', 'Purchase Date', 'Maturity Date', 'ROI to Date'],
    'projected': ['Loan', 'Purchase Date', 'Maturity Date', 'Projected ROI'],
    'capital':   ['Loan', 'Cap Recovered', '% Recovered', 'Remaining'],
    'spread':    ['Loan', 'Purchase Date', 'Maturity Date', 'ROI to Date', 'Δ vs Best'],
  }[mode]

  const best = mode === 'spread' ? (loans[0]?.roiNow ?? 0) : 0

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '45vh', overflow: 'auto', background: '#fff' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} style={i === 0 ? drawerThStyle : drawerThR}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loans.map((loan: any) => {
            const loanId = String(loan.id ?? loan.loanId ?? '')
            const color  = (colorById && colorById[loanId]) ?? loan.loanColor ?? loan.color ?? '#64748b'
            const isFocused = focusedLoanId != null && focusedLoanId === loanId
            const isDimmed  = focusedLoanId != null && !isFocused

            const roiSeries = loan.roiSeries ?? []
const amortSchedule = loan.amort?.schedule ?? []

const currentEntry =
  roiSeries.find((r: any) => {
    const rd = r.date instanceof Date ? r.date : new Date(r.date)
    return (
      rd.getFullYear() === KPI_CURRENT_MONTH.getFullYear() &&
      rd.getMonth() === KPI_CURRENT_MONTH.getMonth()
    )
  }) ?? (roiSeries.length > 0 ? roiSeries[roiSeries.length - 1] : undefined)

const roiDate = currentEntry?.roi ?? 0
const roiProj = roiSeries.length > 0 ? (roiSeries[roiSeries.length - 1]?.roi ?? 0) : 0
const matDate = (() => {
  const last = amortSchedule.length > 0 ? amortSchedule[amortSchedule.length - 1] : undefined
  return last?.loanDate instanceof Date ? fmtMY(last.loanDate) : '—'
})()
const purchDate = loan.purchaseDate
  ? (() => {
      try {
        return fmtMY(new Date(loan.purchaseDate))
      } catch {
        return loan.purchaseDate
      }
    })()
  : '—'

            let capRecovered = 0
            const capInvested = Number(loan.userPurchasePrice ?? loan.purchasePrice ?? 0)
            if (mode === 'capital') {
              ;(loan.amort?.schedule ?? []).forEach((r: any) => {
                if (r.isOwned && r.loanDate instanceof Date && r.loanDate <= KPI_CURRENT_MONTH) {
                  const p = Math.max(0, (Number(r.principalPaid) || 0) - (Number(r.prepayment) || 0))
                  capRecovered += (p + (Number(r.interest) || 0) - (Number(r.feeThisMonth) || 0)) * Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)
                }
              })
            }

            return (
              <tr key={loanId}
                style={{ borderBottom: '1px solid #f1f5f9', background: isFocused ? 'rgba(148,163,184,0.08)' : 'transparent', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.15s' }}
                onMouseEnter={() => onFocusLoan(loanId)}
                onMouseLeave={() => onFocusLoan(null)}
              >
                <td style={{ padding: '9px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{loan.loanName ?? loan.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{loan.school}</div>
                    </div>
                  </div>
                </td>
                {(mode === 'roi-date' || mode === 'projected' || mode === 'spread') && <>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{purchDate}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{matDate}</td>
                </>}
                {mode === 'roi-date' && <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: roiDate >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(roiDate * 100)}</td>}
                {mode === 'projected' && <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color }}>{fmt(roiProj * 100)}</td>}
                {mode === 'capital' && <>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt$(capRecovered)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt(capInvested > 0 ? (capRecovered / capInvested) * 100 : 0)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8' }}>{fmt$(Math.max(0, capInvested - capRecovered))}</td>
                </>}
                {mode === 'spread' && <>
                  <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: loan.roiNow >= 0 ? '#16a34a' : '#dc2626' }}>{fmt(loan.roiNow * 100)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{fmt((loan.roiNow - best) * 100)}</td>
                </>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── KPI Drawer Body ──────────────────────────────────────────────────────────
function KpiDrawerBody({ kpi, loansWithRoi, roiKpis, roiTimeline }: {
  kpi: RoiKpiKey; loansWithRoi: any[]; roiKpis: any; roiTimeline: any
}) {
  const [focusedLoanId, setFocusedLoanId] = useState<string | null>(null)

  const projTimeline = useMemo(() => ({
    perLoanSeries: (roiTimeline?.perLoanSeries ?? []) as LoanSeries[],
    weightedSeries: (roiTimeline?.weightedSeries ?? []) as { date: Date; y: number }[],
    dates: (roiTimeline?.dates ?? []) as Date[],
  }), [roiTimeline])

  // Build color lookup from the already-colored projected timeline series
  // roiTimeline.perLoanSeries has correct colors assigned by usePortfolio
  const colorById = useMemo(() => {
    const map: Record<string, string> = {}
    ;(roiTimeline?.perLoanSeries ?? []).forEach((s: any) => {
      if (s.id != null && s.color) map[String(s.id)] = s.color
    })
    return map
  }, [roiTimeline])

  const getColor = (loan: any): string => {
    const id = String(loan.id ?? loan.loanId ?? '')
    return colorById[id] ?? loan.loanColor ?? loan.color ?? '#64748b'
  }

  // KPI1 — ROI to current month
  const kpi1 = useMemo(() => {
    if (!loansWithRoi.length) return { perLoan: [] as LoanSeries[], weighted: [] as { date: Date; y: number }[], dates: [] as Date[] }
    const validPurchases = loansWithRoi.map((l: any) => new Date(l.purchaseDate)).filter(d => !isNaN(+d))
    const start = new Date(Math.min(...validPurchases.map(d => +d)))
    start.setDate(1); start.setHours(0, 0, 0, 0)
    const dates: Date[] = []
    const cur = new Date(start)
    while (cur <= KPI_CURRENT_MONTH) { dates.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }

    const totalInvested = loansWithRoi.reduce((s: number, l: any) => s + Number(l.userPurchasePrice ?? l.purchasePrice ?? 0), 0)
    const perLoan: LoanSeries[] = loansWithRoi.map((loan: any) => {
      const purchase = new Date(loan.purchaseDate); purchase.setHours(0, 0, 0, 0)
      const data = dates.map(d => {
        if (d < purchase) return { date: d, y: null }
        const e = (loan.roiSeries ?? []).find((r: any) => {
          const rd = r.date instanceof Date ? r.date : new Date(r.date)
          return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth()
        })
        return { date: d, y: e?.roi ?? null }
      })
      return { id: String(loan.id ?? loan.loanId), name: loan.name ?? loan.loanName, color: getColor(loan), data }
    })
    const weighted = dates.map(d => {
      if (totalInvested <= 0) return { date: d, y: 0 }
      let sum = 0
      loansWithRoi.forEach((l: any) => {
        const e = (l.roiSeries ?? []).find((r: any) => { const rd = r.date instanceof Date ? r.date : new Date(r.date); return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth() })
        if (e) sum += e.roi * Number(l.userPurchasePrice ?? l.purchasePrice ?? 0)
      })
      return { date: d, y: sum / totalInvested }
    })
    return { perLoan, weighted, dates }
  }, [loansWithRoi])

  // KPI3 — capital recovery
  const kpi3 = useMemo(() => {
    if (!loansWithRoi.length) return { perLoan: [] as LoanSeries[], portfolio: [] as { date: Date; y: number }[], dates: [] as Date[] }
    const allMs = new Set<number>()
    loansWithRoi.forEach((l: any) => {
      ;(l.amort?.schedule ?? []).forEach((r: any) => {
        if (r.loanDate instanceof Date && r.loanDate <= KPI_CURRENT_MONTH)
          allMs.add(new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime())
      })
    })
    const dates = Array.from(allMs).sort((a, b) => a - b).map(ms => new Date(ms))
    const totalInvested = loansWithRoi.reduce((s: number, l: any) => s + Number(l.userPurchasePrice ?? l.purchasePrice ?? 0), 0)
    const perLoan: LoanSeries[] = loansWithRoi.map((loan: any) => {
      const inv = Number(loan.userPurchasePrice ?? loan.purchasePrice ?? 0)
      if (!inv) return { id: String(loan.id ?? loan.loanId), name: loan.loanName ?? loan.name, color: getColor(loan), data: [] }
      let cum = 0
      const data = dates.map(d => {
        const row = (loan.amort?.schedule ?? []).find((r: any) =>
          r.loanDate instanceof Date && r.loanDate.getFullYear() === d.getFullYear() && r.loanDate.getMonth() === d.getMonth()
        )
        if (row?.isOwned) {
          const p = Math.max(0, (Number(row.principalPaid) || 0) - (Number(row.prepayment) || 0))
          cum += (p + (Number(row.interest) || 0) - (Number(row.feeThisMonth) || 0)) * Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)
        }
        return { date: d, y: cum / inv }
      })
      return { id: String(loan.id ?? loan.loanId), name: loan.name ?? loan.loanName, color: getColor(loan), data }
    })
    let cumP = 0
    const portfolio = dates.map(d => {
      loansWithRoi.forEach((l: any) => {
        const row = (l.amort?.schedule ?? []).find((r: any) =>
          r.loanDate instanceof Date && r.loanDate.getFullYear() === d.getFullYear() && r.loanDate.getMonth() === d.getMonth()
        )
        if (row?.isOwned) {
          const p = Math.max(0, (Number(row.principalPaid) || 0) - (Number(row.prepayment) || 0))
          cumP += (p + (Number(row.interest) || 0) - (Number(row.feeThisMonth) || 0)) * Number(l.ownershipPct ?? l.userOwnershipPct ?? 1)
        }
      })
      return { date: d, y: totalInvested > 0 ? cumP / totalInvested : 0 }
    })
    return { perLoan, portfolio, dates }
  }, [loansWithRoi])

  const portfolioValue = useMemo(() => loansWithRoi.reduce((sum: number, l: any) => {
    const e = (l.roiSeries ?? []).find((r: any) => { const rd = r.date instanceof Date ? r.date : new Date(r.date); return rd.getFullYear() === KPI_CURRENT_MONTH.getFullYear() && rd.getMonth() === KPI_CURRENT_MONTH.getMonth() })
    return sum + Number(e?.loanValue ?? 0)
  }, 0), [loansWithRoi])

  const projPortfolioValue = useMemo(() =>
  loansWithRoi.reduce((sum: number, l: any) => {
    const series = l.roiSeries ?? []
    const last = series.length > 0 ? series[series.length - 1] : undefined
    return sum + Number(last?.loanValue ?? 0)
  }, 0),
[loansWithRoi])

const spreadRows = useMemo(() =>
  loansWithRoi
    .map((l: any) => {
      const series = l.roiSeries ?? []

      const e =
        series.find((r: any) => {
          const rd = r.date instanceof Date ? r.date : new Date(r.date)
          return (
            rd.getFullYear() === KPI_CURRENT_MONTH.getFullYear() &&
            rd.getMonth() === KPI_CURRENT_MONTH.getMonth()
          )
        }) ?? (series.length > 0 ? series[series.length - 1] : undefined)

      return { ...l, roiNow: e?.roi ?? 0 }
    })
    .sort((a: any, b: any) => b.roiNow - a.roiNow),
[loansWithRoi])

  const chartBaseProps = {
    height: 260,
    focusedLoanId,
    onFocusLoan: (id: string | number | null) => setFocusedLoanId(id ? String(id) : null),
    weightedColor: '#000',
    weightedWidth: 2.6,
    weightedLabel: 'Weighted ROI',
  }

  const configs: Record<RoiKpiKey, {
    stat: { pLabel: string; pValue: string; sLabel: string; sValue: string }
    tableTitle: string
    tableMode: 'roi-date' | 'projected' | 'capital' | 'spread'
    tableLoans: any[]
    chart: React.ReactNode
  }> = {
    kpi1: {
      stat: { pLabel: 'Weighted ROI to Date', pValue: fmt(roiKpis.weightedRoi), sLabel: 'Portfolio Value', sValue: fmt$(portfolioValue) },
      tableTitle: 'ROI to Date — Owned Loans',
      tableMode: 'roi-date',
      tableLoans: loansWithRoi,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={kpi1.perLoan} weightedSeries={kpi1.weighted} dates={kpi1.dates} tickSpacingX={Math.max(1, Math.round(kpi1.dates.length / 7))} />,
    },
    kpi2: {
      stat: { pLabel: 'Projected Weighted ROI', pValue: fmt(roiKpis.projectedWeightedRoi), sLabel: 'Projected Portfolio Value', sValue: fmt$(projPortfolioValue) },
      tableTitle: 'Projected ROI at Maturity — Owned Loans',
      tableMode: 'projected',
      tableLoans: loansWithRoi,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={projTimeline.perLoanSeries} weightedSeries={projTimeline.weightedSeries} dates={projTimeline.dates} tickSpacingX={Math.max(1, Math.round(projTimeline.dates.length / 7))} />,
    },
    kpi3: {
      stat: { pLabel: 'Capital Recovered', pValue: fmt(roiKpis.capitalRecoveryPct), sLabel: 'As of', sValue: fmtMY(KPI_CURRENT_MONTH) },
      tableTitle: 'Capital Recovery — Owned Loans',
      tableMode: 'capital',
      tableLoans: loansWithRoi,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={kpi3.perLoan} weightedSeries={kpi3.portfolio} dates={kpi3.dates} tickSpacingX={Math.max(1, Math.round(kpi3.dates.length / 7))} weightedColor="#111827" weightedWidth={3} weightedLabel="Portfolio Recovered" />,
    },
    kpi4: {
      stat: { pLabel: 'ROI Spread', pValue: fmt(roiKpis.roiSpread), sLabel: 'Loans', sValue: String(loansWithRoi.length) },
      tableTitle: 'ROI Spread — Owned Loans',
      tableMode: 'spread',
      tableLoans: spreadRows,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={kpi1.perLoan} weightedSeries={[]} dates={kpi1.dates} tickSpacingX={Math.max(1, Math.round(kpi1.dates.length / 7))} weightedWidth={0} weightedLabel="" />,
    },
  }

  const cfg = configs[kpi]

  return (
    <>
      <ChartBox>{cfg.chart}</ChartBox>
      <StatBar primaryLabel={cfg.stat.pLabel} primaryValue={cfg.stat.pValue} secondaryLabel={cfg.stat.sLabel} secondaryValue={cfg.stat.sValue} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>{cfg.tableTitle}</div>
        <KpiTable loans={cfg.tableLoans} mode={cfg.tableMode} focusedLoanId={focusedLoanId} onFocusLoan={setFocusedLoanId} colorById={colorById} />
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function goBackToHoldings(navigate: ReturnType<typeof useNavigate>) {
  navigate('/reporting-phase2')
}

export default function RoiDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialKpi = (searchParams.get('kpi') as RoiKpiKey) || null
  const initialLoanId = searchParams.get('loan') || null
  const [drawer, setDrawer] = useState<DrawerMode>(initialLoanId ? { kind: 'loan', loanId: initialLoanId } : initialKpi ? { kind: 'kpi', kpi: initialKpi } : null)
  const navigate = useNavigate()
  const { userId } = useUser()
  const { roiKpis, roiTimeline, loansWithRoi, loading, error } = usePortfolio(userId)

  const [filterName,   setFilterName]   = useState('')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterRate,   setFilterRate]   = useState('')
  const [sortKey,      setSortKey]      = useState('')

  const loanNames = useMemo(() => [...new Set(loansWithRoi.map((l: any) => l.loanName ?? l.name ?? ''))].filter(Boolean).sort(), [loansWithRoi])
  const schools   = useMemo(() => [...new Set(loansWithRoi.map((l: any) => l.school ?? ''))].filter(Boolean).sort(), [loansWithRoi])

  const filteredLoans = useMemo(() => {
    let rows = [...loansWithRoi]
    if (filterName)   rows = rows.filter((l: any) => (l.loanName ?? l.name) === filterName)
    if (filterSchool) rows = rows.filter((l: any) => l.school === filterSchool)
    if (filterRate === 'low')  rows = rows.filter((l: any) => { const r = Number(l.nominalRate ?? 0); return (r < 1 ? r * 100 : r) < 5 })
    if (filterRate === 'mid')  rows = rows.filter((l: any) => { const r = Number(l.nominalRate ?? 0); const rp = r < 1 ? r * 100 : r; return rp >= 5 && rp <= 8 })
    if (filterRate === 'high') rows = rows.filter((l: any) => { const r = Number(l.nominalRate ?? 0); return (r < 1 ? r * 100 : r) > 8 })
    if (sortKey === 'purchase_asc')  rows.sort((a: any, b: any) => String(a.purchaseDate).localeCompare(String(b.purchaseDate)))
    if (sortKey === 'purchase_desc') rows.sort((a: any, b: any) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)))
    if (sortKey === 'amount_asc')    rows.sort((a: any, b: any) => Number(a.principal ?? a.origLoanAmt ?? 0) - Number(b.principal ?? b.origLoanAmt ?? 0))
    if (sortKey === 'amount_desc')   rows.sort((a: any, b: any) => Number(b.principal ?? b.origLoanAmt ?? 0) - Number(a.principal ?? a.origLoanAmt ?? 0))
    if (sortKey === 'rate_asc')      rows.sort((a: any, b: any) => Number(a.nominalRate ?? 0) - Number(b.nominalRate ?? 0))
    if (sortKey === 'rate_desc')     rows.sort((a: any, b: any) => Number(b.nominalRate ?? 0) - Number(a.nominalRate ?? 0))
if (sortKey === 'roi_asc')
  rows.sort((a: any, b: any) => {
    const aSeries = a.roiSeries ?? []
    const bSeries = b.roiSeries ?? []

    const aVal = aSeries.length > 1 ? (aSeries[aSeries.length - 2]?.roi ?? 0) : 0
    const bVal = bSeries.length > 1 ? (bSeries[bSeries.length - 2]?.roi ?? 0) : 0

    return aVal - bVal
  })

if (sortKey === 'roi_desc')
  rows.sort((a: any, b: any) => {
    const aSeries = a.roiSeries ?? []
    const bSeries = b.roiSeries ?? []

    const aVal = aSeries.length > 1 ? (aSeries[aSeries.length - 2]?.roi ?? 0) : 0
    const bVal = bSeries.length > 1 ? (bSeries[bSeries.length - 2]?.roi ?? 0) : 0

    return bVal - aVal
  })
    return rows
  }, [loansWithRoi, filterName, filterSchool, filterRate, sortKey])

  function resetFilters() { setFilterName(''); setFilterSchool(''); setFilterRate(''); setSortKey('') }

  const kpis: { key: RoiKpiKey; label: string; value: string }[] = [
    { key: 'kpi1', label: 'Weighted ROI to Current Month', value: fmt(roiKpis.weightedRoi) },
    { key: 'kpi2', label: 'Projected Weighted ROI',        value: fmt(roiKpis.projectedWeightedRoi) },
    { key: 'kpi3', label: 'Capital Recovered',             value: fmt(roiKpis.capitalRecoveryPct) },
    { key: 'kpi4', label: 'ROI Spread',                    value: fmt(roiKpis.roiSpread) },
  ]

  function handleKpiClick(key: RoiKpiKey) {
    setDrawer({ kind: 'kpi', kpi: key })
    setSearchParams({ kpi: key })
  }

  function handleLoanRowClick(loan: any) {
    const loanId = String(loan.loanId ?? loan.id ?? '')
    setDrawer({ kind: 'loan', loanId })
    setSearchParams({ loan: loanId })
  }

  function closeDrawer() {
    setDrawer(null)
    setSearchParams({})
  }

  const drawerOpen = drawer !== null

  // Resolve title & sub for current drawer
  const drawerTitle = (() => {
    if (!drawer) return ''
    if (drawer.kind === 'kpi') return {
      kpi1: 'Weighted ROI to Date',
      kpi2: 'Projected Weighted ROI',
      kpi3: 'Capital Recovery Over Time',
      kpi4: 'ROI Spread',
    }[drawer.kpi]
    const loan = loansWithRoi.find(l => String(l.loanId ?? l.id) === drawer.loanId)
    return loan ? (loan.loanName ?? loan.name ?? drawer.loanId) : drawer.loanId
  })()

  const drawerSubTitle = (() => {
    if (!drawer) return undefined
    if (drawer.kind === 'kpi') return {
      kpi1: 'Current Portfolio Snapshot',
      kpi2: 'Projection to Maturity',
      kpi3: 'Cumulative principal returned as a percentage of purchase price.',
      kpi4: 'Best vs Worst Performing Loans',
    }[drawer.kpi]
    const loan = loansWithRoi.find(l => String(l.loanId ?? l.id) === drawer.loanId)
    if (!loan) return undefined
    const origAmt = Number(loan.originalLoanAmount ?? loan.origLoanAmt ?? loan.loanAmount ?? loan.principal ?? 0)
    const purchasePrice = Number(loan.purchasePrice ?? loan.userPurchasePrice ?? 0)
    return `${loan.school}\nPurchased ${loan.purchaseDate} · Orig Loan Amt ${fmt$(origAmt)} · Loan Purchase Price ${fmt$(purchasePrice)}`
  })()

  const activeLoan = drawer?.kind === 'loan'
    ? loansWithRoi.find(l => String(l.loanId ?? l.id) === drawer.loanId)
    : null

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b', fontSize: 15 }}>
      Loading portfolio…
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#ef4444', fontSize: 15 }}>
      Error: {error}
    </div>
  )

  return (
    <div
  style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
  onClick={(e) => {
    const target = e.target as HTMLElement

    if (target.closest('[data-drawer-shell="true"]')) return
    if (target.closest('[data-drawer-open="true"]')) return

    closeDrawer()
  }}
>

      {/* Page header */}
      <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
      <button
  type="button"
  data-drawer-open="true"
  onClick={() => navigate('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 10,
            padding: 0,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#0ea5e9'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = '#64748b'
          }}
        >
          ← Back to My Holdings
        </button>
        <h1 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Loan Portfolio — ROI</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
          ROI to Date = (Loan Value Today – Purchase Price) / Purchase Price
          &nbsp;&nbsp;·&nbsp;&nbsp;
          Projected ROI = (Final Loan Value – Purchase Price) / Purchase Price
        </p>
        <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#64748b' }}>Current Date: {fmtMY(new Date())}</p>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 10, padding: '0 20px 14px', flexShrink: 0 }}>
        {kpis.map(k => (
          <div
          key={k.key}
          data-drawer-open="true"
          onClick={() => handleKpiClick(k.key)}
            style={{
              flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
              padding: '12px 16px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.10)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,23,42,0.06)' }}
          >
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 20px 12px', flexShrink: 0, flexWrap: 'wrap' }}>
        <select value={filterName}   onChange={e => setFilterName(e.target.value)}   style={filterSelectStyle}>
          <option value="">Name</option>
          {loanNames.map((n: string) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)} style={filterSelectStyle}>
          <option value="">School</option>
          {schools.map((s: string) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterRate}   onChange={e => setFilterRate(e.target.value)}   style={filterSelectStyle}>
          <option value="">Rate</option>
          <option value="low">Below 5%</option>
          <option value="mid">5% – 8%</option>
          <option value="high">Above 8%</option>
        </select>
        <select value={sortKey}      onChange={e => setSortKey(e.target.value)}       style={filterSelectStyle}>
          <option value="">Sort</option>
          <option value="purchase_asc">Purchase Date ↑</option>
          <option value="purchase_desc">Purchase Date ↓</option>
          <option value="amount_asc">Orig Amt ↑</option>
          <option value="amount_desc">Orig Amt ↓</option>
          <option value="rate_asc">Rate ↑</option>
          <option value="rate_desc">Rate ↓</option>
          <option value="roi_asc">ROI ↑</option>
          <option value="roi_desc">ROI ↓</option>
        </select>
        <button onClick={resetFilters} style={filterSelectStyle}>Reset</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            {filteredLoans.length} loan{filteredLoans.length !== 1 ? 's' : ''}
          </span>
          <button style={filterBtnStyle}>Download CSV</button>
          <button style={filterBtnStyle}>Copy CSV</button>
          <button style={filterBtnStyle}>Print</button>
        </div>
      </div>

      {/* Loan table — full width, fills remaining height, completely independent of drawer */}
      <div style={{ flex: 1, padding: '0 20px 20px', overflow: 'hidden', minHeight: 0 }}>
        <LoanTable
          loans={filteredLoans}
          onRowClick={handleLoanRowClick}
        />
      </div>

      <SharedKpiDrawer
        open={drawer?.kind === 'kpi'}
        kpi={drawer?.kind === 'kpi' ? drawer.kpi : null}
        onClose={closeDrawer}
        title={drawerTitle}
        subTitle={drawerSubTitle}
      >
        {drawer?.kind === 'kpi' && (
          <KpiDrawerBody
            kpi={drawer.kpi}
            loansWithRoi={filteredLoans}
            roiKpis={roiKpis}
            roiTimeline={roiTimeline}
          />
        )}
      </SharedKpiDrawer>

      <SharedLoanDrawer
        loan={activeLoan}
        open={drawer?.kind === 'loan'}
        onClose={closeDrawer}
        title={drawerTitle}
        subTitle={drawerSubTitle}
      >
        {drawer?.kind === 'loan' && activeLoan && <LoanDrawerBody loan={activeLoan} />}
      </SharedLoanDrawer>

    </div>
  )
}
