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
            <strong>Effective Date:</strong> August 22, 2025<br />
            <strong>Last Updated:</strong> August 22, 2025
          </p>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Information We Collect</h2>
            
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-blue-700">
                    <strong>Privacy by Design:</strong> We collect only the minimum data necessary to provide our service 
                    and implement privacy-preserving technologies wherever possible.
                  </p>
                </div>
              </div>
            </div>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">1.1 Information You Provide</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Email address and profile information when you create an account</li>
              <li>Website domains and associated metadata when you register sites</li>
              <li>Content modifications and version history made through our service</li>
              <li>Payment information (processed securely by third-party providers)</li>
              <li>Support communications and feedback</li>
              <li>API keys and integration settings (encrypted at rest)</li>
            </ul>

            <h3 className="text-xl font-medium text-gray-800 mb-3">1.2 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Usage analytics and feature interaction data</li>
              <li>IP addresses (hashed for privacy) and geolocation data</li>
              <li>Browser and device information for compatibility</li>
              <li>Session data and authentication tokens</li>
              <li>Performance metrics and error logs</li>
              <li>Security event logs and access patterns</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">1.3 Website Integration Data</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Website structure and content elements (for editing functionality)</li>
              <li>Edit session tokens and authentication data</li>
              <li>Script integration status and configuration</li>
              <li>Website performance impact metrics</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. How We Use Your Information</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">2.1 Service Delivery</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Provide secure content editing and management capabilities</li>
              <li>Maintain user accounts and authentication systems</li>
              <li>Process and store content modifications with version control</li>
              <li>Generate AI-powered content suggestions and translations</li>
              <li>Ensure cross-browser and device compatibility</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">2.2 Security & Compliance</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Monitor for security threats and unauthorized access</li>
              <li>Prevent fraud, abuse, and malicious activities</li>
              <li>Maintain comprehensive audit logs for compliance</li>
              <li>Implement access controls and session management</li>
              <li>Conduct security assessments and vulnerability testing</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">2.3 Service Improvement</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Analyze usage patterns to enhance user experience</li>
              <li>Optimize performance and reduce loading times</li>
              <li>Develop new features based on user needs</li>
              <li>Send important service notifications and security updates</li>
              <li>Provide customer support and technical assistance</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Information Sharing & Data Transfers</h2>
            
            <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-green-700">
                    <strong>Zero-Sale Policy:</strong> We never sell, trade, or rent your personal information to third parties. 
                    Your data is not a product.
                  </p>
                </div>
              </div>
            </div>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">3.1 Limited Sharing Circumstances</h3>
            <p className="text-gray-700 mb-4">
              We may share information only in these strictly limited circumstances:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>With your explicit, informed consent</li>
              <li>To comply with valid legal processes (subpoenas, court orders)</li>
              <li>To protect against immediate threats to safety or security</li>
              <li>In connection with business transfers (with continued privacy protection)</li>
              <li>With essential service providers under Data Processing Agreements (DPAs)</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">3.2 Service Providers & Processors</h3>
            <p className="text-gray-700 mb-4">
              We work with carefully vetted service providers who assist in our operations:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Cloud hosting providers (AWS, Google Cloud) with security certifications</li>
              <li>Payment processors (Stripe) with PCI DSS compliance</li>
              <li>Analytics services with privacy-focused configurations</li>
              <li>Email service providers with encryption capabilities</li>
              <li>All providers operate under strict confidentiality and data protection agreements</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">3.3 International Transfers</h3>
            <p className="text-gray-700 mb-4">
              When data is transferred internationally, we ensure adequate protection through:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Standard Contractual Clauses (SCCs) approved by the European Commission</li>
              <li>Adequacy decisions for countries with equivalent protection</li>
              <li>Additional safeguards such as encryption and access controls</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Data Security & Protection Measures</h2>
            
            <div className="bg-purple-50 border-l-4 border-purple-400 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-purple-700">
                    <strong>Security First:</strong> We implement defense-in-depth security strategies and maintain 
                    SOC 2 Type II compliance for the highest level of data protection.
                  </p>
                </div>
              </div>
            </div>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">4.1 Encryption & Data Protection</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>AES-256 encryption for data at rest</li>
              <li>TLS 1.3 encryption for all data in transit</li>
              <li>End-to-end encryption for sensitive operations</li>
              <li>Encrypted database connections and backups</li>
              <li>Client-side encryption for edit tokens</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">4.2 Access Controls & Authentication</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Multi-factor authentication (MFA) enforcement</li>
              <li>Role-based access control (RBAC) systems</li>
              <li>Just-in-time (JIT) access for administrative operations</li>
              <li>Regular access reviews and privilege rotation</li>
              <li>Zero-trust network architecture</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">4.3 Security Monitoring & Response</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>24/7 security operations center (SOC) monitoring</li>
              <li>Automated threat detection and response systems</li>
              <li>Regular penetration testing and vulnerability assessments</li>
              <li>Intrusion detection and prevention systems (IDS/IPS)</li>
              <li>Comprehensive audit logging and SIEM integration</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">4.4 Infrastructure Security</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Secure, certified cloud hosting environments</li>
              <li>Network segmentation and firewalls</li>
              <li>Regular security patches and updates</li>
              <li>Distributed denial-of-service (DDoS) protection</li>
              <li>Disaster recovery and business continuity planning</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Your Privacy Rights & Controls</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">5.1 Data Subject Rights (GDPR/CCPA Compliance)</h3>
            <p className="text-gray-700 mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li><strong>Access:</strong> Request copies of your personal data and understand how it's processed</li>
              <li><strong>Rectification:</strong> Correct inaccurate or incomplete personal information</li>
              <li><strong>Erasure:</strong> Request deletion of your personal data ("right to be forgotten")</li>
              <li><strong>Portability:</strong> Export your data in a structured, machine-readable format</li>
              <li><strong>Restriction:</strong> Limit the processing of your personal information</li>
              <li><strong>Objection:</strong> Object to processing based on legitimate interests</li>
              <li><strong>Opt-out:</strong> Withdraw consent or opt out of marketing communications</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">5.2 Privacy Controls</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Account settings dashboard for privacy preferences</li>
              <li>Granular consent management for data processing</li>
              <li>Session and authentication token management</li>
              <li>Data retention period customization</li>
              <li>Real-time data processing transparency reports</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">5.3 Exercising Your Rights</h3>
            <p className="text-gray-700 mb-4">
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:privacy@recopyfast.com" className="text-blue-600 hover:underline font-medium">
                privacy@recopyfast.com
              </a>
              . We will respond within 30 days and may require identity verification for security.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Cookies & Tracking Technologies</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">6.1 Types of Cookies We Use</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li><strong>Essential Cookies:</strong> Required for authentication and basic functionality</li>
              <li><strong>Performance Cookies:</strong> Analyze site performance and user experience</li>
              <li><strong>Functional Cookies:</strong> Remember your preferences and settings</li>
              <li><strong>Security Cookies:</strong> Detect suspicious activity and prevent fraud</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">6.2 Cookie Management</h3>
            <p className="text-gray-700 mb-4">
              You have full control over cookies through:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Browser settings and preferences</li>
              <li>Our cookie consent banner and settings</li>
              <li>Third-party opt-out tools and extensions</li>
              <li>Regular cookie cleanup and management</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">6.3 Third-Party Tracking</h3>
            <p className="text-gray-700 mb-4">
              We minimize third-party tracking and use privacy-focused alternatives where possible. 
              Any third-party services are carefully evaluated for privacy compliance.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Data Retention & Deletion</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">7.1 Retention Periods</h3>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li><strong>Account Data:</strong> Retained for the duration of your account</li>
              <li><strong>Content Data:</strong> Retained as long as needed for service delivery</li>
              <li><strong>Usage Analytics:</strong> Aggregated and anonymized after 12 months</li>
              <li><strong>Security Logs:</strong> Retained for 7 years for security and compliance</li>
              <li><strong>Support Communications:</strong> Retained for 3 years</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">7.2 Secure Deletion</h3>
            <p className="text-gray-700 mb-4">
              When data is deleted, we use secure deletion methods including cryptographic erasure 
              and multi-pass overwriting to ensure data cannot be recovered.
            </p>
          </section>
          
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Changes to This Policy</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">8.1 Policy Updates</h3>
            <p className="text-gray-700 mb-4">
              We may update this privacy policy to reflect legal requirements, security enhancements, 
              or service changes. Material changes will be communicated through:
            </p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>Email notifications to all users</li>
              <li>In-app notifications for 30 days</li>
              <li>Updates to the "Last Updated" date</li>
              <li>Prominent notices on our website</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">8.2 Version History</h3>
            <p className="text-gray-700 mb-4">
              Previous versions of this policy are archived and available upon request for 
              transparency and compliance purposes.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Privacy by Design & Compliance</h2>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">9.1 Privacy Frameworks</h3>
            <p className="text-gray-700 mb-4">We comply with major privacy regulations and frameworks:</p>
            <ul className="list-disc pl-6 mb-6 text-gray-700 space-y-2">
              <li>European Union General Data Protection Regulation (GDPR)</li>
              <li>California Consumer Privacy Act (CCPA) and Virginia Consumer Data Protection Act</li>
              <li>Children's Online Privacy Protection Act (COPPA) - we do not knowingly collect data from children under 13</li>
              <li>SOC 2 Type II compliance for security and availability</li>
              <li>ISO 27001 information security management standards</li>
            </ul>
            
            <h3 className="text-xl font-medium text-gray-800 mb-3">9.2 Regular Assessments</h3>
            <p className="text-gray-700 mb-4">
              We conduct regular privacy impact assessments and security audits to ensure 
              ongoing compliance and continuous improvement of our privacy practices.
            </p>
          </section>
          
          <section>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Contact & Data Protection Officer</h2>
            
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Data Protection Officer</h4>
                <p className="text-gray-700 mb-2">
                  <a href="mailto:privacy@recopyfast.com" className="text-blue-600 hover:underline">
                    privacy@recopyfast.com
                  </a>
                </p>
                <p className="text-sm text-gray-600">For privacy rights requests and policy questions</p>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-800 mb-2">Security Team</h4>
                <p className="text-gray-700 mb-2">
                  <a href="mailto:security@recopyfast.com" className="text-blue-600 hover:underline">
                    security@recopyfast.com
                  </a>
                </p>
                <p className="text-sm text-gray-600">For security concerns and vulnerability reports</p>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-800 mb-2">EU Representative</h4>
                <p className="text-gray-700 mb-2">
                  <a href="mailto:eu-representative@recopyfast.com" className="text-blue-600 hover:underline">
                    eu-representative@recopyfast.com
                  </a>
                </p>
                <p className="text-sm text-gray-600">For EU data subject rights and GDPR compliance</p>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-800 mb-2">General Support</h4>
                <p className="text-gray-700 mb-2">
                  <a href="mailto:support@recopyfast.com" className="text-blue-600 hover:underline">
                    support@recopyfast.com
                  </a>
                </p>
                <p className="text-sm text-gray-600">For general inquiries and technical support</p>
              </div>
            </div>
            
            <div className="mt-8 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                <strong>Response Time:</strong> We respond to privacy requests within 30 days. 
                For urgent security matters, we respond within 24 hours.
              </p>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}