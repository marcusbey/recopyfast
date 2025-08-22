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
            <strong>Effective Date:</strong> August 22, 2025<br />
            <strong>Last Updated:</strong> August 22, 2025
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
              ReCopyFast is a content management service that enables website content editing through secure script integration. 
              We provide real-time content editing, multi-language support, AI-powered content suggestions, and collaboration features.
            </p>
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-yellow-700">
                    <strong>Important:</strong> Our service involves embedding scripts on your website. By using ReCopyFast, 
                    you acknowledge that you understand the security implications and trust our security measures.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. User Accounts</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>You must provide accurate and complete information when creating an account</li>
              <li>You are responsible for maintaining the security of your account</li>
              <li>You must notify us immediately of any unauthorized use of your account</li>
              <li>You may not share your account credentials with others</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Acceptable Use & Security Requirements</h2>
            <p className="text-gray-700 mb-4">You agree not to use the Service to:</p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Violate any laws or regulations</li>
              <li>Infringe on intellectual property rights</li>
              <li>Distribute malware, viruses, or harmful content</li>
              <li>Engage in unauthorized access, penetration testing, or data scraping</li>
              <li>Attempt to reverse engineer, decompile, or extract our source code</li>
              <li>Bypass, disable, or interfere with security features</li>
              <li>Inject malicious scripts or code through our editing interface</li>
              <li>Use the Service to compromise other websites or systems</li>
              <li>Spam or send unsolicited communications</li>
              <li>Interfere with the Service's operation, security, or availability</li>
              <li>Share edit tokens or authentication credentials with unauthorized parties</li>
              <li>Use automated tools to abuse our service or bypass rate limits</li>
            </ul>
            
            <div className="bg-red-50 border-l-4 border-red-400 p-4 mt-6">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-red-700">
                    <strong>Security Notice:</strong> Violations of security policies may result in immediate account suspension 
                    and potential legal action. We actively monitor for suspicious activity and maintain detailed audit logs.
                  </p>
                </div>
              </div>
            </div>
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
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Privacy, Data Protection & Security</h2>
            <p className="text-gray-700 mb-4">
              Your privacy and data security are paramount. Please review our Privacy Policy to understand how we collect, 
              use, and protect your information.
            </p>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">6.1 Data Security Measures</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>All data transmission is encrypted using TLS 1.3 or higher</li>
              <li>Content is stored with AES-256 encryption at rest</li>
              <li>Regular security audits and penetration testing</li>
              <li>Multi-factor authentication for account access</li>
              <li>Role-based access controls and session management</li>
              <li>Comprehensive logging and monitoring systems</li>
              <li>GDPR and CCPA compliance protocols</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">6.2 Your Responsibilities</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Maintain strong, unique passwords for your account</li>
              <li>Immediately report suspected security breaches</li>
              <li>Regularly review and rotate edit tokens</li>
              <li>Ensure your website's security before integration</li>
              <li>Keep your website software and plugins updated</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Service Availability & Business Continuity</h2>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>We maintain a target uptime of 99.9% with redundant infrastructure</li>
              <li>Scheduled maintenance is performed during low-traffic periods with advance notice</li>
              <li>We implement disaster recovery procedures to minimize service disruptions</li>
              <li>Real-time status monitoring is available at status.recopyfast.com</li>
              <li>We reserve the right to modify or discontinue features with 30 days notice</li>
              <li>Emergency security updates may be applied without prior notice</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Limitation of Liability & Indemnification</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">8.1 Limitation of Liability</h3>
            <p className="text-gray-700 mb-4">
              To the fullest extent permitted by law, ReCopyFast shall not be liable for any indirect, 
              incidental, special, consequential, or punitive damages, including without limitation, 
              loss of profits, data, use, goodwill, or other intangible losses, whether arising from:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Service interruptions or security incidents</li>
              <li>Third-party integrations or compatibility issues</li>
              <li>Data loss or corruption (though we implement robust backup systems)</li>
              <li>Website performance impacts from our scripts</li>
              <li>User error or misuse of the service</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">8.2 Indemnification</h3>
            <p className="text-gray-700 mb-4">
              You agree to indemnify and hold harmless ReCopyFast from any claims arising from your use 
              of the Service, including but not limited to copyright infringement, security breaches 
              caused by your negligence, or violations of these Terms.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Termination & Data Retention</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">9.1 Termination Rights</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>You may terminate your account at any time through account settings</li>
              <li>We may terminate accounts for violations of these Terms, with notice when possible</li>
              <li>Immediate suspension may occur for security violations or illegal activity</li>
              <li>Upon termination, your right to use the Service ceases immediately</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">9.2 Data Handling Upon Termination</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>We provide 30 days to export your data after account closure</li>
              <li>All edit tokens are immediately invalidated</li>
              <li>Content data is securely deleted within 90 days</li>
              <li>Audit logs may be retained for security and compliance purposes</li>
              <li>Backup systems are purged according to our data retention policy</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Changes to Terms & Compliance</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">10.1 Modifications</h3>
            <p className="text-gray-700 mb-4">
              We may modify these Terms to reflect legal requirements, security enhancements, or service changes. 
              We will notify users of material changes through:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Email notification to registered users</li>
              <li>In-app notifications for 30 days</li>
              <li>Updates to the "Last Updated" date on this page</li>
              <li>Changes become effective 30 days after notification</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">10.2 Regulatory Compliance</h3>
            <p className="text-gray-700 mb-4">
              We comply with applicable data protection and security regulations including GDPR, CCPA, 
              and industry security standards. We regularly review and update our practices to maintain compliance.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">11. Security Incident Response</h2>
            <p className="text-gray-700 mb-4">
              In the event of a security incident, we will:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Immediately investigate and contain the incident</li>
              <li>Notify affected users within 72 hours</li>
              <li>Provide detailed incident reports and remediation steps</li>
              <li>Implement additional security measures to prevent recurrence</li>
              <li>Cooperate fully with law enforcement when required</li>
            </ul>
            
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-blue-700">
                    <strong>Security Contact:</strong> Report security vulnerabilities to{" "}
                    <a href="mailto:security@recopyfast.com" className="text-blue-600 hover:underline font-medium">
                      security@recopyfast.com
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </section>
          
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">12. Contact Information</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Legal Inquiries</h4>
                <p className="text-gray-700">
                  <a href="mailto:legal@recopyfast.com" className="text-blue-600 hover:underline">
                    legal@recopyfast.com
                  </a>
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Security Issues</h4>
                <p className="text-gray-700">
                  <a href="mailto:security@recopyfast.com" className="text-blue-600 hover:underline">
                    security@recopyfast.com
                  </a>
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Data Protection Officer</h4>
                <p className="text-gray-700">
                  <a href="mailto:privacy@recopyfast.com" className="text-blue-600 hover:underline">
                    privacy@recopyfast.com
                  </a>
                </p>
              </div>
              <div>
                <h4 className="font-medium text-gray-800 mb-2">General Support</h4>
                <p className="text-gray-700">
                  <a href="mailto:support@recopyfast.com" className="text-blue-600 hover:underline">
                    support@recopyfast.com
                  </a>
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}