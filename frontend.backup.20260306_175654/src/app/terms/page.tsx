"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsOfService() {
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

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-zinc-500 mb-8">Last updated: February 2, 2026</p>

        <div className="prose prose-invert prose-zinc max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-zinc-300 leading-relaxed">
              By accessing or using zkde.fi (the "Application"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Application. The Application is operated by Obsqra Labs ("we," "us," or "our").
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Eligibility</h2>
            <p className="text-zinc-300 leading-relaxed">
              You must be of legal age in your jurisdiction to form a binding contract to use this Application. By using the Application, you represent that you meet this requirement and that you are not subject to economic sanctions or on any restricted parties list.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Nature of the Application</h2>
            <p className="text-zinc-300 leading-relaxed">
              zkde.fi is a user interface that facilitates interaction with smart contracts deployed on the Starknet blockchain. We do not control the Starknet blockchain, the smart contracts you interact with, or any third-party protocols. The Application is provided as a convenience; you can interact with the same smart contracts directly without using our interface.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. No Financial Advice</h2>
            <p className="text-zinc-300 leading-relaxed">
              Nothing in this Application constitutes financial, investment, legal, or tax advice. We do not recommend any particular digital asset, strategy, or course of action. You are solely responsible for evaluating the risks and merits of using this Application and any transactions you conduct.
            </p>
          </section>

          <section id="risk">
            <h2 className="text-xl font-semibold mb-3">5. Risk Disclosure</h2>
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 my-4">
              <p className="text-zinc-300 leading-relaxed font-medium mb-3">
                BY USING THIS APPLICATION, YOU ACKNOWLEDGE AND ACCEPT THE FOLLOWING RISKS:
              </p>
              <ul className="list-disc list-inside text-zinc-300 space-y-2">
                <li><strong>Loss of funds</strong> — You could lose your entire investment. Cryptocurrency values are highly volatile.</li>
                <li><strong>Smart contract risk</strong> — Smart contracts may contain bugs or vulnerabilities. This software has not been formally audited.</li>
                <li><strong>Irreversible transactions</strong> — Blockchain transactions cannot be reversed once confirmed.</li>
                <li><strong>No regulatory protection</strong> — Cryptocurrency is not legal tender and is not backed by any government. Funds are not protected by deposit insurance schemes.</li>
                <li><strong>Experimental software</strong> — This Application is experimental. Use at your own risk.</li>
                <li><strong>Key management</strong> — You are solely responsible for securing your wallet and private keys. Lost keys cannot be recovered.</li>
                <li><strong>Network risks</strong> — Blockchain networks may experience congestion, forks, or other disruptions.</li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Prohibited Uses</h2>
            <p className="text-zinc-300 leading-relaxed mb-3">
              You agree not to use the Application to:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2">
              <li>Violate any applicable laws or regulations</li>
              <li>Engage in money laundering, terrorist financing, or sanctions evasion</li>
              <li>Conduct fraudulent or deceptive activities</li>
              <li>Interfere with or disrupt the Application or servers</li>
              <li>Attempt to gain unauthorized access to any systems</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Intellectual Property</h2>
            <p className="text-zinc-300 leading-relaxed">
              The Application source code is open source and available under the Apache-2.0 license. The "zkde.fi," "Obsqra Labs," "zkDE," and "GATE" names and logos are trademarks of Obsqra Labs.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Disclaimer of Warranties</h2>
            <p className="text-zinc-300 leading-relaxed">
              THE APPLICATION IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT THE APPLICATION WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE. WE DISCLAIM ALL WARRANTIES INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Limitation of Liability</h2>
            <p className="text-zinc-300 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, OBSQRA LABS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR DIGITAL ASSETS, ARISING FROM YOUR USE OF THE APPLICATION.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Indemnification</h2>
            <p className="text-zinc-300 leading-relaxed">
              You agree to indemnify and hold harmless Obsqra Labs and its affiliates from any claims, damages, or expenses arising from your use of the Application or violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Dispute Resolution</h2>
            <p className="text-zinc-300 leading-relaxed">
              Any disputes arising from these Terms or your use of the Application shall be resolved through binding arbitration rather than in court. You waive any right to participate in a class action lawsuit or class-wide arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Modifications</h2>
            <p className="text-zinc-300 leading-relaxed">
              We reserve the right to modify these Terms at any time. Changes will be posted on this page. Your continued use of the Application after changes constitutes acceptance of the modified Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Severability</h2>
            <p className="text-zinc-300 leading-relaxed">
              If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in effect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">14. Contact</h2>
            <p className="text-zinc-300 leading-relaxed">
              For questions about these Terms, contact us at{" "}
              <a href="mailto:legal@obsqra.xyz" className="text-emerald-400 hover:text-emerald-300">
                legal@obsqra.xyz
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
