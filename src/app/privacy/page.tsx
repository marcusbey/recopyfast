import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="prose prose-lg max-w-none">
          <h1 className="text-4xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
          
          <p className="text-gray-600 mb-8">
            <strong>Effective Date:</strong> January 2024<br />
            <strong>Last Updated:</strong> January 2024
          </p>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Information We Collect</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">1.1 Information You Provide</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Email address when you sign up for an account</li>
              <li>Website domain and content when you register a site</li>
              <li>Content modifications made through our service</li>
            </ul>

            <h3 className="text-xl font-medium text-gray-800 mb-3">1.2 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Usage data and analytics</li>
              <li>IP addresses and browser information</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. How We Use Your Information</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Provide and improve our content management services</li>
              <li>Send important service notifications and updates</li>
              <li>Analyze usage patterns to enhance user experience</li>
              <li>Ensure security and prevent fraud</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Information Sharing</h2>
            <p className="text-gray-700 mb-4">
              We do not sell, trade, or rent your personal information to third parties. We may share information in these limited circumstances:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>With your explicit consent</li>
              <li>To comply with legal obligations</li>
              <li>To protect our rights and safety</li>
              <li>With service providers who assist in our operations (under strict confidentiality agreements)</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Data Security</h2>
            <p className="text-gray-700 mb-4">
              We implement industry-standard security measures to protect your information, including:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Encryption of data in transit and at rest</li>
              <li>Regular security audits and updates</li>
              <li>Access controls and authentication measures</li>
              <li>Secure hosting infrastructure</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Your Rights</h2>
            <p className="text-gray-700 mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Access your personal information</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and associated data</li>
              <li>Export your data</li>
              <li>Opt out of marketing communications</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Cookies</h2>
            <p className="text-gray-700 mb-4">
              We use cookies to enhance your experience and analyze site usage. You can control cookie settings in your browser preferences.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Changes to This Policy</h2>
            <p className="text-gray-700 mb-4">
              We may update this privacy policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the "Last Updated" date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Contact Us</h2>
            <p className="text-gray-700">
              If you have any questions about this privacy policy, please contact us at{" "}
              <a href="mailto:privacy@recopyfast.com" className="text-blue-600 hover:underline">
                privacy@recopyfast.com
              </a>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}