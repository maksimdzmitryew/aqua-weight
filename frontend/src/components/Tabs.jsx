import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../ThemeContext.jsx'

export default function Tabs({ tabs, activeTab, onChange, ariaLabel, stackOnMobile = true }) {
  const { effectiveTheme } = useTheme()
  const isDark = effectiveTheme === 'dark'
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 640)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const styles = useMemo(() => {
    const borderColor = isDark ? '#1f2937' : '#e5e7eb'
    const inactiveColor = isDark ? '#9ca3af' : '#374151'

    return {
      tabsWrap: {
        display: 'flex',
        gap: 8,
        borderBottom: `1px solid ${borderColor}`,
        marginBottom: 16,
        ...(stackOnMobile && isMobile ? { display: 'block' } : {}),
      },
      button: {
        width: stackOnMobile && isMobile ? '100%' : undefined,
        marginBottom: stackOnMobile && isMobile ? 8 : 0,
        padding: '8px 12px',
        borderRadius: '6px 6px 0 0',
        border: `1px solid ${borderColor}`,
        borderBottom: 0,
        cursor: 'pointer',
      },
      activeButton: {
        background: isDark ? '#111827' : '#111827',
        color: 'white',
        borderColor: 'transparent',
      },
      inactiveButton: {
        background: 'transparent',
        color: inactiveColor,
      },
    }
  }, [isDark, isMobile, stackOnMobile])

  return (
    <div style={styles.tabsWrap} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.value === activeTab
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.value)}
            style={{
              ...styles.button,
              ...(isActive ? styles.activeButton : styles.inactiveButton),
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
