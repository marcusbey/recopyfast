import { Code2, Search, Edit3 } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Code2,
    title: "Add Script Tag",
    description: "Copy-paste our lightweight script before </body>. That's it - no complex setup required.",
    code: `<script src="https://cdn.recopyfast.com/embed/recopyfast.js"
        data-site-id="your-site-id"></script>`,
    visual: "Code snippet with one-click copy"
  },
  {
    number: "02",
    icon: Search,
    title: "Content Detection",
    description: "ReCopyFast automatically finds and indexes all editable text elements on your website.",
    code: "// Auto-detection in progress...\nScanning: <h1>, <p>, <span>, <div>\nFound: 47 editable elements ✓\nAI suggestions: Ready ✓",
    visual: "Website scan animation highlighting text"
  },
  {
    number: "03",
    icon: Edit3,
    title: "Edit in Real-time",
    description: "Click any text to edit it instantly with AI-powered suggestions and real-time synchronization.",
    code: "// Click to edit mode active\nuser.click(element) → editor.show()\nai.suggest() → options.display()\nchange.sync() → broadcast.all() ✓",
    visual: "Inline editing interface preview"
  }
];

export default function HowItWorks() {
  return (
    <section className="py-20 bg-gradient-to-br from-gray-50 to-blue-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
            How It Works
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Transform your website into an AI-powered editable platform in three simple steps. 
            No backend changes, no complex setup, no headaches.
          </p>
        </div>

        <div className="space-y-16">
          {steps.map((step, index) => (
            <div
              key={index}
              className={`flex flex-col ${
                index % 2 === 0 ? "lg:flex-row" : "lg:flex-row-reverse"
              } items-center gap-12 lg:gap-20`}
            >
              {/* Content */}
              <div className="flex-1 space-y-6">
                <div className="flex items-center space-x-4">
                  <span className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">{step.number}</span>
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                    <step.icon className="h-6 w-6 text-white" />
                  </div>
                </div>
                
                <h3 className="text-3xl font-bold text-gray-900">{step.title}</h3>
                <p className="text-xl text-gray-600">{step.description}</p>
                
                <div className="bg-gray-900 rounded-xl p-6">
                  <pre className="text-green-400 font-mono text-sm overflow-x-auto">
                    <code>{step.code}</code>
                  </pre>
                </div>
              </div>

              {/* Visual */}
              <div className="flex-1">
                <div className="bg-white rounded-2xl border border-gray-200 p-8">
                  <div className="space-y-4">
                    {step.number === "01" && (
                      <div className="space-y-3">
                        <div className="h-4 bg-blue-200 rounded animate-pulse"></div>
                        <div className="h-4 bg-blue-200 rounded w-3/4 animate-pulse"></div>
                        <div className="h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded text-white flex items-center justify-center text-sm font-medium">
                          Script Tag Added ✓
                        </div>
                      </div>
                    )}
                    
                    {step.number === "02" && (
                      <div className="space-y-3">
                        <div className="relative">
                          <div className="h-4 bg-yellow-200 rounded animate-pulse"></div>
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400 to-transparent animate-pulse opacity-50"></div>
                        </div>
                        <div className="relative">
                          <div className="h-4 bg-yellow-200 rounded w-3/4 animate-pulse"></div>
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400 to-transparent animate-pulse opacity-50"></div>
                        </div>
                        <div className="h-6 bg-green-200 rounded flex items-center justify-center text-sm font-medium text-green-800">
                          47 elements detected + AI ready
                        </div>
                      </div>
                    )}
                    
                    {step.number === "03" && (
                      <div className="space-y-3">
                        <div className="h-4 bg-blue-300 rounded cursor-pointer hover:bg-blue-400 transition-colors border-2 border-blue-500"></div>
                        <div className="h-4 bg-blue-300 rounded w-3/4 cursor-pointer hover:bg-blue-400 transition-colors"></div>
                        <div className="flex items-center space-x-2 text-sm text-blue-700 bg-blue-50 p-2 rounded">
                          <Edit3 className="h-4 w-4" />
                          <span>AI-powered editing mode active</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <div className="inline-flex items-center px-6 py-3 rounded-full bg-green-100 text-green-700 text-lg font-medium mb-6">
            <span className="w-3 h-3 bg-green-500 rounded-full mr-3 animate-pulse"></span>
            Ready in under 5 minutes
          </div>
        </div>
      </div>
    </section>
  );
}