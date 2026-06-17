import React from 'react'
import { Link } from 'react-router-dom'

const ApiDocs = () => {
  return (
    <div className="bg-surface font-body-md text-on-surface selection:bg-secondary-container selection:text-on-secondary-container min-h-screen flex flex-col">
      {/* TopNavBar */}
      <nav className="fixed top-0 left-0 w-full z-50 bg-surface/80 dark:bg-on-background/80 backdrop-blur-md border-b border-outline-variant/30 shadow-sm px-margin-mobile md:px-margin-desktop py-4">
        <div className="max-w-container-max mx-auto flex justify-between items-center h-12">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3">
              <img
                alt="Aqua Weight Logo"
                className="h-10 w-10 object-contain"
                src="https://lh3.googleusercontent.com/aida/AP1WRLtnLgqpmsXcbAsEpFXMMoPZ9NAe6jAZRQSID_f9etZIdIue-JPD4jmMEeLh0rNf05y3CKtwgsbjtrn18JZavy_Zvq3ISzvrodrOgGnxo_V4eXncs20Uy4OGlDsWzlPS4L0hW_Td19eq2192_KJBFX0yGg3Uwlv7bXMkkUHJjq4hFjct24Tp5jdZLbaEQ69QB8Z-hIzm70tOUO8tMSXwwk2AEYoCVkqkmyojUgHFOcvs_bKZjcSpoSOC7uTO"
              />
              <span className="text-headline-md font-headline-md font-bold text-on-background dark:text-surface-bright whitespace-nowrap">
                Aqua Weight
              </span>
            </Link>
          </div>
          <div className="hidden md:flex gap-8 items-center">
            <Link
              className="font-label-caps text-label-caps text-on-surface-variant dark:text-outline hover:text-primary transition-colors"
              to="/"
            >
              Home
            </Link>
            <Link
              className="font-label-caps text-label-caps text-on-surface-variant dark:text-outline hover:text-primary transition-colors"
              to="/dashboard"
            >
              Dashboard
            </Link>
          </div>
          <Link
            to="/login"
            className="bg-primary hover:bg-primary-container text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-full transition-all duration-300 active:scale-95 whitespace-nowrap"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <main className="flex-grow pt-24 px-margin-mobile md:px-margin-desktop">
        <div className="max-w-container-max mx-auto py-stack-lg">
          <div className="flex flex-col gap-4 mb-12">
            <h1 className="font-headline-xl text-headline-xl text-gradient">API Documentation</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
              Integrate with the Aqua Weight ecosystem. Our API provides full access to plant data,
              sensor measurements, and system configurations.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-stack-md">
            <section className="glass-card p-8 rounded-[24px] border border-outline-variant/30">
              <h2 className="font-headline-md text-headline-md mb-4 text-on-surface">
                Interactive Explorer
              </h2>
              <p className="text-on-surface-variant mb-6">
                Discover and test our endpoints directly from your browser using our interactive
                Swagger UI or ReDoc explorers.
              </p>
              <div className="flex flex-wrap gap-4">
                <a
                  href="/api/docs"
                  className="bg-secondary text-on-secondary font-label-caps text-label-caps px-6 py-3 rounded-full hover:shadow-lg transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined">api</span>
                  Swagger UI
                </a>
                <a
                  href="/api/redoc"
                  className="bg-surface border border-outline text-on-surface font-label-caps text-label-caps px-6 py-3 rounded-full hover:bg-surface-container-low transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined">menu_book</span>
                  ReDoc
                </a>
              </div>
            </section>

            <section className="glass-card p-8 rounded-[24px] border border-outline-variant/30">
              <h2 className="font-headline-md text-headline-md mb-4 text-on-surface">
                Base Configuration
              </h2>
              <p className="text-on-surface-variant mb-4">
                All requests should be made to our versioned V1 base URL.
              </p>
              <div className="bg-surface-container-highest p-4 rounded-xl font-label-sm text-label-sm border border-outline-variant/20 overflow-x-auto">
                <code className="text-primary font-bold">https://aw.max/api/v1</code>
              </div>
              <p className="text-xs text-on-surface-variant mt-4 italic">
                Note: An alias is also available at <code>/api</code> for convenience.
              </p>
            </section>

            <section className="glass-card p-8 rounded-[24px] border border-outline-variant/30">
              <h2 className="font-headline-md text-headline-md mb-4 text-on-surface">
                Authentication
              </h2>
              <p className="text-on-surface-variant mb-4">
                We use JWT-based authentication. Include your access token in the Authorization
                header for all protected requests.
              </p>
              <div className="bg-surface-container-highest p-4 rounded-xl font-label-sm text-label-sm border border-outline-variant/20 overflow-x-auto">
                <code className="text-on-surface">Authorization: Bearer &lt;your_token&gt;</code>
              </div>
            </section>

            <section className="glass-card p-8 rounded-[24px] border border-outline-variant/30">
              <h2 className="font-headline-md text-headline-md mb-4 text-on-surface">
                Rate Limits
              </h2>
              <p className="text-on-surface-variant">
                To ensure system stability, we implement fair-use rate limiting. Standard accounts
                are limited to 1000 requests per hour. Contact support if you need higher limits for
                industrial applications.
              </p>
            </section>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-stack-lg px-margin-mobile md:px-margin-desktop bg-surface-container-highest dark:bg-on-background border-t border-outline-variant/20">
        <div className="max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-gutter">
          <div className="flex flex-col gap-2 items-center md:items-start">
            <div className="flex items-center gap-3">
              <img
                alt="Aqua Weight Logo Small"
                className="h-8 w-8 object-contain"
                src="https://lh3.googleusercontent.com/aida/AP1WRLtnLgqpmsXcbAsEpFXMMoPZ9NAe6jAZRQSID_f9etZIdIue-JPD4jmMEeLh0rNf05y3CKtwgsbjtrn18JZavy_Zvq3ISzvrodrOgGnxo_V4eXncs20Uy4OGlDsWzlPS4L0hW_Td19eq2192_KJBFX0yGg3Uwlv7bXMkkUHJjq4hFjct24Tp5jdZLbaEQ69QB8Z-hIzm70tOUO8tMSXwwk2AEYoCVkqkmyojUgHFOcvs_bKZjcSpoSOC7uTO"
              />
              <span className="font-headline-md text-headline-md font-black text-on-surface dark:text-surface-bright">
                Aqua Weight
              </span>
            </div>
            <p className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline mt-2">
              © 2024 Aqua Weight AI IoT Systems. All rights reserved.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
            <a
              className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline"
              href="#"
            >
              Privacy Policy
            </a>
            <a
              className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline"
              href="#"
            >
              Terms of Service
            </a>
            <a
              className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline"
              href="#"
            >
              Contact Support
            </a>
            <Link
              className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline"
              to="/api-docs"
            >
              API Documentation
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default ApiDocs
