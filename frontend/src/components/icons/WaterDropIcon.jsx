import React from 'react'

export default function WaterDropIcon({ size = 20, color = 'currentColor', className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0"></path>
      <path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"></path>
      <path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"></path>
    </svg>
  )
}
