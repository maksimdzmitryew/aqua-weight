import React from 'react'
import IconButton from './IconButton.jsx'
import { useLocation, useNavigate } from 'react-router-dom'

export default function QuickCreateButtons({ plantUuid, plantName, compact = false }) {
  const location = useLocation();
  const navigate = useNavigate()
  const spacing = compact ? 2 : 6

  const openPlant = (actionName, plantId) => {
    navigate(`/measurement/${actionName}${plantUuid ? `?plant=${plantUuid}` : ''}`, { state: { from: location.pathname + location.search } });
  };

  return (
    <span style={{ display: 'inline-flex', gap: spacing }}>
      <IconButton icon="beaker" label={`Measurement for ${plantName || 'plant'}`} onClick={() => openPlant('weight', plantUuid)} variant="primary" />
      <IconButton icon="droplet" label={`Watering for ${plantName || 'plant'}`} onClick={() => openPlant('watering', plantUuid)} variant="primary" />
      <IconButton icon="box" label={`Repotting for ${plantName || 'plant'}`} onClick={() => openPlant('repotting', plantUuid)} variant="primary" />
    </span>
  )
}
