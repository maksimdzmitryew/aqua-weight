import React from 'react'
import IconButton from './IconButton.jsx'
import { useLocation, useNavigate } from 'react-router-dom'

export default function QuickCreateButtons({
  plantUuid,
  plantName,
  compact = false,
  highlightWater = false,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const spacing = compact ? 2 : 6

  const openPlant = (actionName) => {
    navigate(`/measurement/${actionName}${plantUuid ? `?plant=${plantUuid}` : ''}`, {
      state: { from: location.pathname + location.search },
    })
  }

  return (
    <span style={{ display: 'inline-flex', gap: spacing }}>
      <IconButton
        icon="scale"
        label={`Measurement for ${plantName || 'plant'}`}
        onClick={() => openPlant('weight')}
        variant="primary"
      />
      <span className={highlightWater ? 'qc-water qc-water--needs' : 'qc-water'}>
        <IconButton
          icon="waves"
          label={`Watering for ${plantName || 'plant'}`}
          onClick={() => openPlant('watering')}
          variant="primary"
        />
      </span>
      <IconButton
        icon="pot"
        label={`Repotting for ${plantName || 'plant'}`}
        onClick={() => openPlant('repotting')}
        variant="primary"
      />
    </span>
  )
}
