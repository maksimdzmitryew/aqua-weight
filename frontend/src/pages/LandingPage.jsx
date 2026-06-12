import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const LandingPage = () => {
  useEffect(() => {
    const cards = document.querySelectorAll('.glass-card');
    const handlers = [];

    cards.forEach(card => {
      const handleMouseEnter = () => {
        card.style.transform = 'translateY(-8px)';
        card.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      };
      const handleMouseLeave = () => {
        card.style.transform = 'translateY(0)';
      };
      card.addEventListener('mouseenter', handleMouseEnter);
      card.addEventListener('mouseleave', handleMouseLeave);
      handlers.push({ card, handleMouseEnter, handleMouseLeave });
    });

    return () => {
      handlers.forEach(({ card, handleMouseEnter, handleMouseLeave }) => {
        card.removeEventListener('mouseenter', handleMouseEnter);
        card.removeEventListener('mouseleave', handleMouseLeave);
      });
    };
  }, []);

  return (
    <div className="bg-surface font-body-md text-on-surface selection:bg-secondary-container selection:text-on-secondary-container">
      {/* TopNavBar */}
      <nav className="fixed top-0 left-0 w-full z-50 bg-surface/80 dark:bg-on-background/80 backdrop-blur-md border-b border-outline-variant/30 shadow-sm px-margin-mobile md:px-margin-desktop py-4">
        <div className="max-w-container-max mx-auto flex justify-between items-center h-12">
          <div className="flex items-center gap-3">
            <img alt="Aqua Weight Logo" className="h-10 w-10 object-contain" src="https://lh3.googleusercontent.com/aida/AP1WRLtnLgqpmsXcbAsEpFXMMoPZ9NAe6jAZRQSID_f9etZIdIue-JPD4jmMEeLh0rNf05y3CKtwgsbjtrn18JZavy_Zvq3ISzvrodrOgGnxo_V4eXncs20Uy4OGlDsWzlPS4L0hW_Td19eq2192_KJBFX0yGg3Uwlv7bXMkkUHJjq4hFjct24Tp5jdZLbaEQ69QB8Z-hIzm70tOUO8tMSXwwk2AEYoCVkqkmyojUgHFOcvs_bKZjcSpoSOC7uTO" />
            <span className="text-headline-md font-headline-md font-bold text-on-background dark:text-surface-bright whitespace-nowrap">Aqua Weight</span>
          </div>
          <div className="hidden md:flex gap-8 items-center">
            <a className="font-label-caps text-label-caps text-secondary dark:text-secondary-fixed-dim border-secondary" href="#features">Features</a>
            <a className="font-label-caps text-label-caps text-on-surface-variant dark:text-outline hover:text-primary transition-colors" href="#how-it-works">How it Works</a>
            <a className="font-label-caps text-label-caps text-on-surface-variant dark:text-outline hover:text-primary transition-colors" href="#technology">Technology</a>
            <Link className="font-label-caps text-label-caps text-on-surface-variant dark:text-outline hover:text-primary transition-colors" to="/dashboard">Dashboard</Link>
          </div>
          <Link to="/login" className="bg-primary hover:bg-primary-container text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-full transition-all duration-300 active:scale-95 whitespace-nowrap">
            Get Started
          </Link>
        </div>
      </nav>

      <main className="overflow-x-hidden">
        {/* Hero Section */}
        <section className="relative px-margin-mobile md:px-margin-desktop py-stack-lg min-h-screen flex items-center">
          <div className="absolute inset-0 water-flow-pattern -z-10"></div>
          <div className="max-w-container-max mx-auto grid lg:grid-cols-2 gap-stack-lg items-center w-full">
            <div className="flex flex-col gap-6 max-w-[736px]" data-aos="fade-right">
              <div className="inline-flex items-center gap-2 px-4 py-1 bg-secondary-container text-on-secondary-container rounded-full w-fit">
                <span className="material-symbols-outlined text-[16px]">eco</span>
                <span className="font-label-caps text-label-caps">Next-Gen Plant Care</span>
              </div>
              <h1 className="font-headline-xl text-headline-xl md:text-6xl text-gradient leading-tight">Precision. Plant. Care.<br />Powered by Gravity.</h1>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-lg">
                The IoT system that understands your plants' thirst through weight-based signatures. Automated, manual, or vacation mode — always water enough.
              </p>
              <div className="flex flex-wrap gap-4 mt-4">
                <Link to="/login" className="bg-primary text-on-primary font-label-caps text-label-caps px-8 py-4 rounded-full shadow-lg hover:shadow-xl transition-all hover:translate-y-[-2px] flex items-center gap-2">
                  Get Started <span className="material-symbols-outlined">arrow_forward</span>
                </Link>
                <button className="bg-surface border border-outline text-on-surface font-label-caps text-label-caps px-8 py-4 rounded-full hover:bg-surface-container-low transition-all flex items-center gap-2">
                  Watch Demo <span className="material-symbols-outlined">play_circle</span>
                </button>
              </div>
            </div>
            <div className="relative group w-full" data-aos="fade-left">
              <div className="absolute -inset-4 bg-gradient-to-tr from-secondary-container/30 to-primary-fixed/30 blur-2xl rounded-[40px] -z-10 group-hover:scale-105 transition-transform duration-700"></div>
              <img alt="Plant on Aqua Weight Smart Base" className="w-[90%] ml-auto h-auto rounded-[32px] shadow-2xl ring-1 ring-outline-variant/30 object-cover block" src="https://lh3.googleusercontent.com/aida/AP1WRLs2HnNoCUuJZPoXUTOejH5Efhn2bhAFwQ7c_qQ2NX8F8O9RrNzP1wjn96Au9V_hE3oThQRjBhX4JaGHhWmPs81g_bB3XvC_qwzu3v6Wns3sWIEjFUJHO5qi5QjEsivpPQEb-O7rHHZLNkuYtjWIlTgHPdAhimp73Sw2h_1QtKOSv_kTMRLhNeUPd00K_s1_TYyA7MIvd9pAFXFDKxgmvLBanQNrBKIaTWJ6vVSs3dcYcnIFRJiZucaGcEJf" />
            </div>
          </div>
        </section>

        {/* Smart Watering Section (Features) */}
        <section id="features" className="bg-surface-container-low px-margin-mobile md:px-margin-desktop py-stack-lg">
          <div className="max-w-container-max mx-auto">
            <div className="text-center mb-16">
              <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4">Smart Watering for Every Scenario.</h2>
              <p className="text-on-surface-variant max-w-2xl mx-auto">Choose the mode that fits your lifestyle. Our intelligent gravity-sensing base handles the rest.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-gutter">
              {/* Card 1: Automatic */}
              <div className="glass-card p-8 rounded-[24px] flex flex-col gap-4 group hover:border-secondary/50 transition-colors" style={{ transform: 'translateY(0px)', transition: 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
                <div className="w-14 h-14 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: '"FILL" 1' }}>auto_mode</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Automatic</h3>
                <p className="text-on-surface-variant">Sensor-driven intelligence.</p>
                <div><br /><div><i>Be reminded of watering exactly when needed by each plant individually. Our algorithms detect precise moisture evaporation through weight loss.</i></div></div>
                <div className="mt-auto pt-6">
                  <div className="flex items-center gap-2 text-on-secondary-container bg-secondary-container/50 px-4 py-2 rounded-xl">
                    <span className="material-symbols-outlined text-sm">notifications</span>
                    <span className="font-label-sm text-label-sm">Push Alerts</span>
                  </div>
                  <div className="mt-4">
                    <div className="w-full bg-outline-variant/20 h-1 rounded-full overflow-hidden">
                      <div className="bg-secondary h-full w-[99%]"></div>
                    </div>
                    <span className="font-label-sm text-label-sm text-secondary mt-2 inline-block">99% Accuracy Gain 24/7</span>
                  </div>
                </div>
              </div>
              {/* Card 2: Manual */}
              <div className="glass-card p-8 rounded-[24px] flex flex-col gap-4 group hover:border-secondary/50 transition-colors" style={{ transform: 'translateY(0px)', transition: 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
                <div className="w-14 h-14 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: '"FILL" 1' }}>touch_app</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Manual</h3>
                <p className="text-on-surface-variant">Take full control at convenient time.</p>
                <div><br /><div><i>Get immediate real-time watering suggestion specific to each plant as soon as its weight is entered manually by owner or a helping person.</i></div></div>
                <div className="mt-auto pt-6">
                  <div className="flex items-center gap-2 text-on-secondary-container bg-secondary-container/50 px-4 py-2 rounded-xl">
                    <span className="material-symbols-outlined text-sm">list_alt</span>
                    <span className="font-label-sm text-label-sm">Live Logs</span>
                  </div>
                  <div className="mt-4">
                    <div className="w-full bg-outline-variant/20 h-1 rounded-full overflow-hidden">
                      <div className="bg-secondary h-full w-[99%]"></div>
                    </div>
                    <span className="font-label-sm text-label-sm text-secondary mt-2 inline-block">99% Accuracy Gain ad-hoc</span>
                  </div>
                </div>
              </div>
              {/* Card 3: Vacation */}
              <div className="glass-card p-8 rounded-[24px] flex flex-col gap-4 group hover:border-secondary/50 transition-colors" style={{ transform: 'translateY(0px)', transition: 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
                <div className="w-14 h-14 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: '"FILL" 1' }}>flight_takeoff</span>
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Vacation</h3>
                <p className="text-on-surface-variant">Worry-free growth with smart projections.</p>
                <div><br /></div><div><i>Receive gentle nudges on your phone exactly when the pot reaches the 'thirst' threshold based on historical weight-to-moisture patterns.</i></div>
                <div className="mt-auto pt-6">
                  <div className="flex items-center gap-2 text-on-secondary-container bg-secondary-container/50 px-4 py-2 rounded-xl">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span className="font-label-sm text-label-sm">Smart Projected Care Active</span>
                  </div>
                  <div className="mt-4">
                    <div className="w-full bg-outline-variant/20 h-1 rounded-full overflow-hidden">
                      <div className="bg-secondary h-full w-[77%]"></div>
                    </div>
                    <span className="font-label-sm text-label-sm text-secondary mt-2 inline-block">77% Accuracy Projection</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Core Stack Section (Technology) */}
        <section id="technology" className="px-margin-mobile md:px-margin-desktop py-stack-lg bg-surface">
          <div className="max-w-container-max mx-auto">
            <div className="grid lg:grid-cols-2 gap-stack-lg items-center">
              <div className="relative order-2 lg:order-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 rounded-2xl bg-surface-container flex flex-col items-center gap-3 text-center border border-outline-variant/30">
                    <span className="material-symbols-outlined text-4xl text-secondary">bolt</span>
                    <span className="font-headline-md text-headline-md">FastAPI</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Performant Backend</span>
                  </div>
                  <div className="p-6 rounded-2xl bg-surface-container-high flex flex-col items-center gap-3 text-center border border-outline-variant/30 transform">
                    <span className="material-symbols-outlined text-4xl text-secondary">layers</span>
                    <span className="font-headline-md text-headline-md">React</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Reactive Dashboard</span>
                  </div>
                  <div className="p-6 rounded-2xl bg-surface-container-high flex flex-col items-center gap-3 text-center border border-outline-variant/30">
                    <span className="material-symbols-outlined text-4xl text-secondary">database</span>
                    <span className="font-headline-md text-headline-md">MariaDB</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Secure Data Persistence</span>
                  </div>
                  <div className="p-6 rounded-2xl bg-surface-container flex flex-col items-center gap-3 text-center border border-outline-variant/30 transform">
                    <span className="material-symbols-outlined text-4xl text-secondary">router</span>
                    <span className="font-headline-md text-headline-md">Nginx</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Robust Reverse Proxy</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-6 lg:pl-12 order-1 lg:order-2">
                <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface">Built for Reliability.</h2>
                <p className="font-body-lg text-body-lg text-on-surface-variant">Our core stack is designed for low latency and high availability. From the sensor to your screen, every byte of weight data is processed with extreme precision and industrial-grade stability.</p>
                <ul className="space-y-4 mt-4">
                  <li className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    </div>
                    <span className="text-on-surface">Real-time WebSocket updates</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    </div>
                    <span className="text-on-surface">Asynchronous task management</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center">
                      <span className="material-symbols-outlined text-secondary text-sm">check</span>
                    </div>
                    <span className="text-on-surface">Scalable microservices architecture</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Unified Security & Privacy Section */}
        <section className="px-margin-mobile md:px-margin-desktop py-stack-lg bg-navy-navy text-surface overflow-hidden relative">
          {/* Background Shield Graphic */}
          <div className="absolute inset-0 pointer-events-none opacity-10 flex items-center justify-center -z-0">
            <span className="material-symbols-outlined text-[600px] text-secondary" style={{ fontVariationSettings: '"FILL" 0, "wght" 100' }}>shield_with_heart</span>
          </div>
          <div className="max-w-container-max mx-auto relative z-10">
            <div className="text-center mb-16">
              <h2 className="font-headline-xl text-headline-xl text-white mb-4">Security &amp; Privacy</h2>
              <p className="text-slate-300 max-w-2xl mx-auto">Industry-grade safeguards protecting your growth, data, and identity.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-x-gutter gap-y-16">
              {/* 1. Privacy by Design */}
              <div className="flex flex-col gap-6 p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-secondary/30 transition-colors">
                <div className="flex flex-col gap-2">
                  <h3 className="font-headline-lg text-white">Privacy by Design</h3>
                  <p className="font-label-caps text-secondary uppercase tracking-wider text-sm font-semibold">Your privacy is our priority.</p>
                </div>
                <p className="text-slate-300 font-body-md leading-relaxed">
                  Your identity remains fully anonymous. We implement robust security measures to ensure your plant care data remains yours alone, utilizing industry-standard encryption and privacy-first account management.
                </p>
                <div className="mt-auto pt-6 flex items-start gap-4 border-t">
                  <img alt="Null User Data Icon" className="w-10 h-10 object-contain rounded-lg" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAYOAbfvnAXibPX0jDr6FMkruOomyZidMOSmB2YsvxjyDmjTFQuUc0fyoX5qdaXEmBKXYgfTigTE1kXlezxgPAxM3F9FGa-lVoIZ7yTBbFK8KiNMC3s14WpV69R7w8Z_SLP7Eyh-5h0Iy25qS1bntn1MrCZ-aJT5e3wuz_uuSpsOZ96L6ICueA7xWvzhC6K4EwFct6PnzC67ltFmefO7IJbGQmDnmSX8IAv9iyMGKOIcEOrqTdDgOiW4mf4hohy_zD-kupVblqh3f4V" />
                  <div>
                    <span className="font-label-caps text-label-caps block mb-1 text-white">Null User Data</span>
                    <p className="text-xs text-slate-400">Account creation requires only a username and password. Providing an email address is entirely optional.</p>
                  </div>
                </div>
              </div>
              {/* 2. Protection by Principle */}
              <div className="flex flex-col gap-6 p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-secondary/30 transition-colors">
                <div className="flex flex-col gap-2">
                  <h3 className="font-headline-lg text-white">Protection by Principle</h3>
                  <p className="font-label-caps text-secondary uppercase tracking-wider text-sm font-semibold">Foundational data-minimization rules.</p>
                </div>
                <p className="text-slate-300 font-body-md leading-relaxed">
                  Our system is built on a foundation of proactive data protection and user-centric privacy principles. We prioritize minimal data collection to maximize your digital safety.
                </p>
                <div className="mt-auto pt-6 flex items-start gap-4 border-t">
                  <img alt="Zero Device Info Icon" className="w-10 h-10 object-contain rounded-lg" src="https://lh3.googleusercontent.com/aida/AP1WRLvYbkPMv-OJEH18LSN-NwcBc0hcw_rliXT7ini9d2icufDSLpgJv6vGwWIiu4devR8tFWiAaOlThR16JQLLmHetNWj5J9kHHxbsu6Exd_seCZ8nxq2NWFDbD0MaEVOcRf9EKhU-SCY8-QnMJT3ri8fWVayBXWbtOfIGJduMPeW5_aWGQnDe_KcMV-f-_iO3WiwTGWT8DLVhCpDG3h6nH1m48GnhDEx_5D3AzeYGyoqJL1YGnS5Yzl3ij2A" />
                  <div>
                    <span className="font-label-caps text-label-caps block mb-1 text-white">Zero Device Info</span>
                    <p className="text-xs text-slate-400">Only if you choose to trust specific device for a faster login experience would device fingerprint be saved.</p>
                  </div>
                </div>
              </div>
              {/* 3. Security by Engineering */}
              <div className="flex flex-col gap-6 p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-secondary/30 transition-colors">
                <div className="flex flex-col gap-2">
                  <h3 className="font-headline-lg text-white">Security by Engineering</h3>
                  <p className="font-label-caps text-secondary uppercase tracking-wider text-sm font-semibold">Fortifying integrity with industrial-grade safeguards.</p>
                </div>
                <p className="text-slate-300 font-body-md leading-relaxed">
                  Best industry-grade LLMs perform regular automated penetration tests to ensure the highest standards of system resilience and data safety are maintained against evolving threats.
                </p>
                <div className="mt-auto pt-6 flex items-start gap-4 border-t">
                  <img alt="MFA Icon" className="w-10 h-10 object-contain" src="https://lh3.googleusercontent.com/aida/AP1WRLv-4kxTbJ7NACZ50eINrVqfgbIDxSuN4LC7FdWLxT8kMGdsYf0fjBQ9shTNJAJPfIScFnhj9GC1kN2jbUkdetyCGk-UKGhm4FLR3-5JT_Uoywyu1gnp8miF5FUEfaIsLpBSIkDEDCyaNJOrAcF1mWFR8qC0LdPfA6s_dMgiUMl6x4csaWc60s6wh2CzmiD4VVzCtHzK22X1_GWhAUyyrHwDRTdWotTWh1haUbG6zg3j0JnzuhztVBX-oH0v" />
                  <div>
                    <span className="font-label-caps text-label-caps block mb-1 text-white">Multi-Factor Authentication</span>
                    <p className="text-xs text-slate-400">Ensure that only you can access your account by requiring an MFA verification step via secure standards.</p>
                  </div>
                </div>
              </div>
              {/* 4. Integrity by Architecture */}
              <div className="flex flex-col gap-6 p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-secondary/30 transition-colors">
                <div className="flex flex-col gap-2">
                  <h3 className="font-headline-lg text-white">Integrity by Architecture</h3>
                  <p className="font-label-caps text-secondary uppercase tracking-wider text-sm font-semibold">Hardware-level security.</p>
                </div>
                <p className="text-slate-300 font-body-md leading-relaxed">
                  Our system is built on a foundation of hardware-level security and immutable design principles. We secure the firmware and the communication pipeline at the source.
                </p>
                <div className="mt-auto pt-6 flex items-start gap-4 border-t">
                  <span className="material-symbols-outlined text-4xl text-secondary">memory</span>
                  <div>
                    <span className="font-label-caps text-label-caps block mb-1 text-white">Hardened IoT Core</span>
                    <p className="text-xs text-slate-400">Every IoT device operates with a hardened core to ensure data integrity and system resilience from the ground up.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-stack-lg px-margin-mobile md:px-margin-desktop bg-surface-container-highest dark:bg-on-background border-t border-outline-variant/20">
        <div className="max-w-container-max mx-auto flex flex-col md:flex-row justify-between items-center gap-gutter">
          <div className="flex flex-col gap-2 items-center md:items-start">
            <div className="flex items-center gap-3">
              <img alt="Aqua Weight Logo Small" className="h-8 w-8 object-contain" src="https://lh3.googleusercontent.com/aida/AP1WRLtnLgqpmsXcbAsEpFXMMoPZ9NAe6jAZRQSID_f9etZIdIue-JPD4jmMEeLh0rNf05y3CKtwgsbjtrn18JZavy_Zvq3ISzvrodrOgGnxo_V4eXncs20Uy4OGlDsWzlPS4L0hW_Td19eq2192_KJBFX0yGg3Uwlv7bXMkkUHJjq4hFjct24Tp5jdZLbaEQ69QB8Z-hIzm70tOUO8tMSXwwk2AEYoCVkqkmyojUgHFOcvs_bKZjcSpoSOC7uTO" />
              <span className="font-headline-md text-headline-md font-black text-on-surface dark:text-surface-bright">Aqua Weight</span>
            </div>
            <p className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline mt-2">© 2024 Aqua Weight IoT Systems. All rights reserved.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
            <a className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline" href="#">Privacy Policy</a>
            <a className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline" href="#">Terms of Service</a>
            <a className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline" href="#">Contact Support</a>
            <Link className="font-label-sm text-label-sm text-on-surface-variant dark:text-outline hover:text-primary transition-colors underline" to="/api-docs">API Documentation</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
