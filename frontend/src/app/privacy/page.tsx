"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-zinc-500 mb-8">Last updated: February 2, 2026</p>

        <div className="prose prose-invert prose-zinc max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-3">Overview</h2>
            <p className="text-zinc-300 leading-relaxed">
              zkde.fi is operated by Obsqra Labs. This Privacy Policy explains how we collect, use, and protect information when you use our application. We are committed to protecting your privacy and collecting only the minimum data necessary for the application to function.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">What We Collect</h2>
            <ul className="list-disc list-inside text-zinc-300 space-y-2">
              <li><strong>Public blockchain addresses</strong> — Required for application functionality. These are public by nature of blockchain technology.</li>
              <li><strong>Device and browser information</strong> — Basic analytics (device type, browser version) to improve the application.</li>
              <li><strong>localStorage data</strong> — User preferences and session data stored locally in your browser.</li>
              <li><strong>Transaction data</strong> — On-chain transaction hashes and receipts, which are publicly visible on the blockchain.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">What We Do NOT Collect</h2>
            <ul className="list-disc list-inside text-zinc-300 space-y-2">
              <li>Names, email addresses, or physical addresses</li>
              <li>We do not link wallet addresses to personal identity</li>
              <li>We do not log IP addresses for tracking purposes</li>
              <li>We do not sell or share any data with third parties for marketing</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Blockchain Data</h2>
            <p className="text-zinc-300 leading-relaxed">
              zkde.fi interacts with the Starknet blockchain. All blockchain transactions are public and immutable. We do not control the blockchain and cannot modify or delete on-chain data. Your wallet address and transaction history on the blockchain are publicly visible to anyone.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Third-Party Services</h2>
            <p className="text-zinc-300 leading-relaxed mb-3">
              We use the following third-party services:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2">
              <li><strong>RPC Providers</strong> — To query blockchain state (Alchemy, Infura, or public Starknet RPC)</li>
              <li><strong>Wallet Providers</strong> — ArgentX, Braavos, or other Starknet wallets you choose to connect</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-3">
              These services have their own privacy policies. We encourage you to review them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Cookies</h2>
            <p className="text-zinc-300 leading-relaxed">
              We use minimal cookies for essential functionality only:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2 mt-2">
              <li><strong>Session cookies</strong> — To maintain your session state</li>
              <li><strong>Preference cookies</strong> — To remember your settings</li>
            </ul>
            <p className="text-zinc-300 leading-relaxed mt-3">
              We do not use cookies for advertising or cross-site tracking.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Security</h2>
            <p className="text-zinc-300 leading-relaxed">
              We implement industry-standard security measures including HTTPS encryption, secure headers, and content security policies. However, no system is completely secure. You are responsible for securing your wallet and private keys.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your Rights</h2>
            <p className="text-zinc-300 leading-relaxed">
              Since we collect minimal data and do not maintain user accounts, there is limited personal data to access, modify, or delete. localStorage data can be cleared through your browser settings. Blockchain data cannot be deleted as it is immutable by design.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
            <p className="text-zinc-300 leading-relaxed">
              We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact</h2>
            <p className="text-zinc-300 leading-relaxed">
              For privacy-related questions, contact us at{" "}
              <a href="mailto:privacy@obsqra.xyz" className="text-emerald-400 hover:text-emerald-300">
                privacy@obsqra.xyz
              </a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 text-center">
          <p className="text-xs text-zinc-500">
            zkde.fi by Obsqra Labs
          </p>
        </div>
      </div>
    </main>
  );
}
