import { useState } from 'react'
import { Tooltip } from './Tooltip'

interface Props {
  pct: number
  color: string
  size?: number
}

export default function OwnershipPie({ pct, color, size = 26 }: Props) {
  const [hovered, setHovered] = useState(false)
  const clamped = Math.max(0, Math.min(1, pct))
  const filledSlices = Math.round(clamped * 20)
  const cx = 12, cy = 12, radius = 9, sliceAngle = 360 / 20
  const rads = (d: number) => (Math.PI / 180) * d

  const paths = Array.from({ length: 20 }, (_, i) => {
    const start = i * sliceAngle, end = start + sliceAngle
    const x1 = cx + radius * Math.cos(rads(start - 90))
    const y1 = cy + radius * Math.sin(rads(start - 90))
    const x2 = cx + radius * Math.cos(rads(end - 90))
    const y2 = cy + radius * Math.sin(rads(end - 90))
    return (
      <path
        key={i}
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`}
        fill={i < filledSlices ? color : 'transparent'}
        stroke='#e2e8f0'
        strokeWidth={0.8}
      />
    )
  })

  return (
    <Tooltip lines={[`${Math.round(clamped * 100)}% of Loan Owned`]}>
      <svg
        viewBox="0 0 24 24" width={size} height={size}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          cursor: 'pointer', display: 'block', flexShrink: 0,
          transition: 'transform 0.15s ease',
          transform: hovered ? 'scale(1.5)' : 'scale(1)',
        }}
      >
        {paths}
      </svg>
    </Tooltip>
  )
}
