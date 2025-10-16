import React from 'react'
import IconButton from './IconButton.jsx'
import { useNavigate } from 'react-router-dom'

export default function QuickCreateButtons({ plantUuid, plantName, compact = false }) {
  const navigate = useNavigate()
  const spacing = compact ? 4 : 6
  return (
    <span style={{ display: 'inline-flex', gap: spacing }}>
      <IconButton icon="beaker" label={`Measurement for ${plantName || 'plant'}`} onClick={() => navigate(`/measurement/new${plantUuid ? `?plant=${plantUuid}` : ''}`)} variant="primary" />
      <IconButton icon="droplet" label={`Watering for ${plantName || 'plant'}`} onClick={() => navigate(`/measurement/watering${plantUuid ? `?plant=${plantUuid}` : ''}`)} variant="primary" />
      <IconButton icon="box" label={`Repotting for ${plantName || 'plant'}`} onClick={() => navigate(`/measurement/repotting${plantUuid ? `?plant=${plantUuid}` : ''}`)} variant="primary" />
    </span>
  )
}
