import { 
  Zap, 
  Globe, 
  Users, 
  BarChart3, 
  Languages, 
  TestTube,
  Wand2,
  Shield,
  CheckCircle
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Real-time Updates",
    description: "Changes reflect instantly across all connected browsers without page refresh",
    gradient: "from-yellow-500 to-orange-500"
  },
  {
    icon: Wand2,
    title: "AI-Powered Suggestions",
    description: "Get intelligent content improvements and writing assistance with one click",
    gradient: "from-purple-500 to-pink-500"
  },
  {
    icon: Languages,
    title: "Universal Translation",
    description: "Translate entire websites to 12+ languages instantly with AI",
    gradient: "from-blue-500 to-cyan-500"
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Multiple editors with role-based permissions and real-time sync",
    gradient: "from-green-500 to-emerald-500"
  },
  {
    icon: BarChart3,
    title: "Version Control",
    description: "Track changes, see edit history, and rollback when needed",
    gradient: "from-indigo-500 to-purple-500"
  },
  {
    icon: TestTube,
    title: "A/B Testing",
    description: "Create content variants and test them with your audience",
    gradient: "from-red-500 to-orange-500"
  },
  {
    icon: Globe,
    title: "Universal Compatibility",
    description: "Works with any website technology - React, Vue, WordPress, static sites",
    gradient: "from-blue-500 to-purple-500"
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description: "SOC 2 compliance, audit logging, and enterprise-grade security",
    gradient: "from-gray-500 to-slate-500"
  },
  {
    icon: CheckCircle,
    title: "Zero Downtime",
    description: "99.9% uptime SLA with intelligent failover and graceful degradation",
    gradient: "from-teal-500 to-green-500"
  }
];

export default function Features() {
  return (
    <section id="features" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
            Everything You Need for{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Modern Content Management
            </span>
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            ReCopyFast combines the simplicity of direct editing with the power of enterprise-grade content management and AI assistance.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group bg-white rounded-2xl p-8 border border-gray-200 hover:border-gray-300 transition-colors duration-200"
            >
              <div className="mb-6">
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center`}>
                  <feature.icon className="h-7 w-7 text-white" />
                </div>
              </div>
              
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                {feature.title}
              </h3>
              
              <p className="text-gray-600 leading-relaxed">
                {feature.description}
              </p>

              {/* Hover effect indicator */}
              <div className={`mt-6 h-1 rounded-full bg-gradient-to-r ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></div>
            </div>
          ))}
        </div>

        {/* Feature Spotlight */}
        <div className="mt-20 bg-gradient-to-br from-blue-50 to-purple-50 rounded-3xl p-12">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-3xl font-bold text-gray-900 mb-6">
                Built for Scale, Designed for Simplicity
              </h3>
              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                  <p className="text-gray-700">
                    <strong>Performance First:</strong> Sub-100ms response times with intelligent caching and CDN optimization
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                  <p className="text-gray-700">
                    <strong>Enterprise Ready:</strong> SOC 2 compliance, audit logging, role-based access control, and SSO integration
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                  <p className="text-gray-700">
                    <strong>Developer Friendly:</strong> TypeScript support, comprehensive REST API, webhooks, and graceful fallbacks
                  </p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                  <p className="text-gray-700">
                    <strong>AI Powered:</strong> GPT-4 integration for content suggestions, translation, and automated improvements
                  </p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-2xl p-8 border border-gray-200">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">Uptime</span>
                  <span className="text-green-600 font-semibold">99.9%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full" style={{ width: "99.9%" }}></div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">Response Time</span>
                  <span className="text-blue-600 font-semibold">&lt;100ms</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full" style={{ width: "95%" }}></div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">Security Score</span>
                  <span className="text-purple-600 font-semibold">A+</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-gradient-to-r from-purple-500 to-purple-600 h-2 rounded-full" style={{ width: "100%" }}></div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">Customer Satisfaction</span>
                  <span className="text-orange-600 font-semibold">98%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-gradient-to-r from-orange-500 to-orange-600 h-2 rounded-full" style={{ width: "98%" }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}