import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function Terms() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="prose prose-lg max-w-none">
          <h1 className="text-4xl font-bold text-gray-900 mb-8">Terms of Service</h1>
          
          <p className="text-gray-600 mb-8">
            <strong>Effective Date:</strong> January 2024<br />
            <strong>Last Updated:</strong> January 2024
          </p>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Acceptance of Terms</h2>
            <p className="text-gray-700 mb-4">
              By accessing or using ReCopyFast ("Service"), you agree to be bound by these Terms of Service ("Terms"). 
              If you disagree with any part of these terms, you may not access the Service.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Description of Service</h2>
            <p className="text-gray-700 mb-4">
              ReCopyFast is a content management service that allows users to make websites editable through a simple script integration. 
              Our service provides real-time content editing, multi-language support, and collaboration features.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibent text-gray-900 mb-4">3. User Accounts</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>You must provide accurate and complete information when creating an account</li>
              <li>You are responsible for maintaining the security of your account</li>
              <li>You must notify us immediately of any unauthorized use of your account</li>
              <li>You may not share your account credentials with others</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Acceptable Use</h2>
            <p className="text-gray-700 mb-4">You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Violate any laws or regulations</li>
              <li>Infringe on intellectual property rights</li>
              <li>Distribute malware or harmful content</li>
              <li>Engage in unauthorized access or data scraping</li>
              <li>Spam or send unsolicited communications</li>
              <li>Interfere with the Service's operation or security</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Content and Intellectual Property</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>You retain ownership of content you create or modify through our Service</li>
              <li>You grant us a limited license to process and store your content to provide the Service</li>
              <li>You are responsible for ensuring you have rights to any content you edit</li>
              <li>ReCopyFast and its features are protected by intellectual property laws</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Privacy and Data</h2>
            <p className="text-gray-700 mb-4">
              Your privacy is important to us. Please review our Privacy Policy to understand how we collect, 
              use, and protect your information.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Service Availability</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>We strive to maintain high service availability but cannot guarantee 100% uptime</li>
              <li>We may perform maintenance that temporarily affects service availability</li>
              <li>We reserve the right to modify or discontinue features with reasonable notice</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Limitation of Liability</h2>
            <p className="text-gray-700 mb-4">
              To the fullest extent permitted by law, ReCopyFast shall not be liable for any indirect, 
              incidental, special, consequential, or punitive damages, including without limitation, 
              loss of profits, data, use, goodwill, or other intangible losses.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Termination</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>You may terminate your account at any time</li>
              <li>We may terminate or suspend accounts for violations of these Terms</li>
              <li>Upon termination, your right to use the Service ceases immediately</li>
              <li>We will provide reasonable notice before termination when possible</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Changes to Terms</h2>
            <p className="text-gray-700 mb-4">
              We reserve the right to modify these Terms at any time. We will notify users of any changes 
              by posting the new Terms on this page and updating the "Last Updated" date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Contact Information</h2>
            <p className="text-gray-700">
              If you have any questions about these Terms of Service, please contact us at{" "}
              <a href="mailto:legal@recopyfast.com" className="text-blue-600 hover:underline">
                legal@recopyfast.com
              </a>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}