import React, { useEffect, useState } from 'react'

export default function App() {
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    fetch('/api/')
      .then(r => r.json())
      .then(d => setMessage(d.message))
      .catch(() => setMessage('Failed to reach backend'))
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>AW Frontend</h1>
      <p>Backend says: {message}</p>
      <p>
        Try <code>/api/hello/YourName</code> via this domain: <a href="https://aw.max">https://aw.max</a>
      </p>
      <hr style={{ margin: '24px 0' }} />
      <p>
        Go to your <a href="/dashboard">Dashboard</a>
      </p>
    </div>
  )
}
