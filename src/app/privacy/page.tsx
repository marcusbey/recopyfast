import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import {
  Shield,
  Lock,
  Eye,
  Database,
  Globe,
  Mail,
  FileText,
  AlertCircle,
} from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-24">
        {/* Hero section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-100 mb-6">
            <Shield className="w-8 h-8 text-sky-600" />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-4">
            Privacy Policy
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Your privacy matters. We&apos;re committed to protecting your data
            with transparency and care.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-slate-500">
            <span>
              <strong>Effective:</strong> August 22, 2025
            </span>
            <span className="hidden sm:inline">|</span>
            <span>
              <strong>Last Updated:</strong> August 22, 2025
            </span>
          </div>
        </div>

        {/* Quick summary cards */}
        <div className="grid sm:grid-cols-3 gap-4 mb-16">
          <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
            <Lock className="w-6 h-6 text-sky-600 mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">
              Encrypted Data
            </h3>
            <p className="text-sm text-slate-600">
              AES-256 encryption at rest, TLS 1.3 in transit
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
            <Eye className="w-6 h-6 text-sky-600 mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">No Data Sales</h3>
            <p className="text-sm text-slate-600">
              We never sell your personal information
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-sky-100 shadow-sm">
            <Database className="w-6 h-6 text-sky-600 mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">Your Control</h3>
            <p className="text-sm text-slate-600">
              Export or delete your data anytime
            </p>
          </div>
        </div>

        {/* Main content */}
        <div className="prose prose-slate max-w-none">
          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                1
              </span>
              Information We Collect
            </h2>

            <div className="bg-sky-50 border-l-4 border-sky-400 p-4 mb-6 rounded-r-lg">
              <p className="text-sm text-sky-800">
                <strong>Privacy by Design:</strong> We collect only the minimum
                data necessary to provide our service and implement
                privacy-preserving technologies wherever possible.
              </p>
            </div>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              1.1 Information You Provide
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                Email address and profile information when you create an account
              </li>
              <li>
                Website domains and associated metadata when you register sites
              </li>
              <li>
                Content modifications and version history made through our
                service
              </li>
              <li>
                Payment information (processed securely by third-party
                providers)
              </li>
              <li>Support communications and feedback</li>
              <li>API keys and integration settings (encrypted at rest)</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              1.2 Automatically Collected Information
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>Usage analytics and feature interaction data</li>
              <li>IP addresses (hashed for privacy) and geolocation data</li>
              <li>Browser and device information for compatibility</li>
              <li>Session data and authentication tokens</li>
              <li>Performance metrics and error logs</li>
              <li>Security event logs and access patterns</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              1.3 Website Integration Data
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>
                Website structure and content elements (for editing
                functionality)
              </li>
              <li>Edit session tokens and authentication data</li>
              <li>Script integration status and configuration</li>
              <li>Website performance impact metrics</li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                2
              </span>
              How We Use Your Information
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              2.1 Service Delivery
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                Provide secure content editing and management capabilities
              </li>
              <li>Maintain user accounts and authentication systems</li>
              <li>
                Process and store content modifications with version control
              </li>
              <li>Generate AI-powered content suggestions and translations</li>
              <li>Ensure cross-browser and device compatibility</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              2.2 Security & Compliance
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>Monitor for security threats and unauthorized access</li>
              <li>Prevent fraud, abuse, and malicious activities</li>
              <li>Maintain comprehensive audit logs for compliance</li>
              <li>Implement access controls and session management</li>
              <li>Conduct security assessments and vulnerability testing</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              2.3 Service Improvement
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>Analyze usage patterns to enhance user experience</li>
              <li>Optimize performance and reduce loading times</li>
              <li>Develop new features based on user needs</li>
              <li>Send important service notifications and security updates</li>
              <li>Provide customer support and technical assistance</li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                3
              </span>
              Information Sharing & Data Transfers
            </h2>

            <div className="bg-sky-50 border-l-4 border-sky-400 p-4 mb-6 rounded-r-lg">
              <p className="text-sm text-sky-800">
                <strong>Zero-Sale Policy:</strong> We never sell, trade, or rent
                your personal information to third parties. Your data is not a
                product.
              </p>
            </div>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              3.1 Limited Sharing Circumstances
            </h3>
            <p className="text-slate-600 mb-4">
              We may share information only in these strictly limited
              circumstances:
            </p>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>With your explicit, informed consent</li>
              <li>
                To comply with valid legal processes (subpoenas, court orders)
              </li>
              <li>
                To protect against immediate threats to safety or security
              </li>
              <li>
                In connection with business transfers (with continued privacy
                protection)
              </li>
              <li>
                With essential service providers under Data Processing
                Agreements (DPAs)
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              3.2 Service Providers & Processors
            </h3>
            <p className="text-slate-600 mb-4">
              We work with carefully vetted service providers who assist in our
              operations:
            </p>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                Cloud hosting providers (AWS, Google Cloud) with security
                certifications
              </li>
              <li>Payment processors (Stripe) with PCI DSS compliance</li>
              <li>Analytics services with privacy-focused configurations</li>
              <li>Email service providers with encryption capabilities</li>
              <li>
                All providers operate under strict confidentiality and data
                protection agreements
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              3.3 International Transfers
            </h3>
            <p className="text-slate-600 mb-4">
              When data is transferred internationally, we ensure adequate
              protection through:
            </p>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>
                Standard Contractual Clauses (SCCs) approved by the European
                Commission
              </li>
              <li>
                Adequacy decisions for countries with equivalent protection
              </li>
              <li>
                Additional safeguards such as encryption and access controls
              </li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                4
              </span>
              Data Security & Protection
            </h2>

            <div className="bg-sky-50 border-l-4 border-sky-400 p-4 mb-6 rounded-r-lg">
              <p className="text-sm text-sky-800">
                <strong>Security First:</strong> We implement defense-in-depth
                security strategies and maintain SOC 2 Type II compliance for
                the highest level of data protection.
              </p>
            </div>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              4.1 Encryption & Data Protection
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>AES-256 encryption for data at rest</li>
              <li>TLS 1.3 encryption for all data in transit</li>
              <li>End-to-end encryption for sensitive operations</li>
              <li>Encrypted database connections and backups</li>
              <li>Client-side encryption for edit tokens</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              4.2 Access Controls & Authentication
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>Multi-factor authentication (MFA) enforcement</li>
              <li>Role-based access control (RBAC) systems</li>
              <li>Just-in-time (JIT) access for administrative operations</li>
              <li>Regular access reviews and privilege rotation</li>
              <li>Zero-trust network architecture</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              4.3 Security Monitoring & Response
            </h3>
            <ul className="list-disc pl-6 text-slate-600 space-y-2">
              <li>24/7 security operations center (SOC) monitoring</li>
              <li>Automated threat detection and response systems</li>
              <li>Regular penetration testing and vulnerability assessments</li>
              <li>Intrusion detection and prevention systems (IDS/IPS)</li>
              <li>Comprehensive audit logging and SIEM integration</li>
            </ul>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                5
              </span>
              Your Privacy Rights & Controls
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              5.1 Data Subject Rights (GDPR/CCPA Compliance)
            </h3>
            <p className="text-slate-600 mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                <strong>Access:</strong> Request copies of your personal data
                and understand how it&apos;s processed
              </li>
              <li>
                <strong>Rectification:</strong> Correct inaccurate or incomplete
                personal information
              </li>
              <li>
                <strong>Erasure:</strong> Request deletion of your personal data
                (&ldquo;right to be forgotten&rdquo;)
              </li>
              <li>
                <strong>Portability:</strong> Export your data in a structured,
                machine-readable format
              </li>
              <li>
                <strong>Restriction:</strong> Limit the processing of your
                personal information
              </li>
              <li>
                <strong>Objection:</strong> Object to processing based on
                legitimate interests
              </li>
              <li>
                <strong>Opt-out:</strong> Withdraw consent or opt out of
                marketing communications
              </li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              5.2 Exercising Your Rights
            </h3>
            <p className="text-slate-600">
              To exercise any of these rights, contact us at{" "}
              <a
                href="mailto:privacy@recopyfast.com"
                className="text-sky-600 hover:underline font-medium"
              >
                privacy@recopyfast.com
              </a>
              . We will respond within 30 days and may require identity
              verification for security.
            </p>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                6
              </span>
              Cookies & Tracking
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mb-3">
              Types of Cookies We Use
            </h3>
            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                <strong>Essential:</strong> Required for authentication and
                basic functionality
              </li>
              <li>
                <strong>Performance:</strong> Analyze site performance and user
                experience
              </li>
              <li>
                <strong>Functional:</strong> Remember your preferences and
                settings
              </li>
              <li>
                <strong>Security:</strong> Detect suspicious activity and
                prevent fraud
              </li>
            </ul>

            <p className="text-slate-600">
              You have full control over cookies through browser settings and
              our cookie consent banner.
            </p>
          </section>

          <section className="mb-12 bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-4 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                7
              </span>
              Data Retention
            </h2>

            <ul className="list-disc pl-6 mb-6 text-slate-600 space-y-2">
              <li>
                <strong>Account Data:</strong> Retained for the duration of your
                account
              </li>
              <li>
                <strong>Content Data:</strong> Retained as long as needed for
                service delivery
              </li>
              <li>
                <strong>Usage Analytics:</strong> Aggregated and anonymized
                after 12 months
              </li>
              <li>
                <strong>Security Logs:</strong> Retained for 7 years for
                compliance
              </li>
              <li>
                <strong>Support Communications:</strong> Retained for 3 years
              </li>
            </ul>

            <p className="text-slate-600">
              When data is deleted, we use secure deletion methods including
              cryptographic erasure to ensure data cannot be recovered.
            </p>
          </section>

          <section className="bg-white rounded-2xl p-8 border border-sky-100 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-900 mb-6 flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center text-sm font-semibold text-sky-600">
                8
              </span>
              Contact Us
            </h2>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    Data Protection Officer
                  </h4>
                  <a
                    href="mailto:privacy@recopyfast.com"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    privacy@recopyfast.com
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    Privacy rights & policy questions
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    Security Team
                  </h4>
                  <a
                    href="mailto:security@recopyfast.com"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    security@recopyfast.com
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    Security concerns & vulnerability reports
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    EU Representative
                  </h4>
                  <a
                    href="mailto:eu-representative@recopyfast.com"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    eu-representative@recopyfast.com
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    EU data subject rights & GDPR
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 mb-1">
                    General Support
                  </h4>
                  <a
                    href="mailto:support@recopyfast.com"
                    className="text-sky-600 hover:underline text-sm"
                  >
                    support@recopyfast.com
                  </a>
                  <p className="text-xs text-slate-500 mt-1">
                    General inquiries & technical support
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 p-4 bg-sky-50 rounded-xl">
              <p className="text-sm text-slate-600">
                <strong>Response Time:</strong> We respond to privacy requests
                within 30 days. For urgent security matters, we respond within
                24 hours.
              </p>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
