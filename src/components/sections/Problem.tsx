import { AlertCircle, Clock, Settings, Users } from "lucide-react";

const problems = [
  {
    icon: Clock,
    title: "Every text change requires developer time",
    description: "Simple copy updates become complex development tasks, delaying campaigns and product launches"
  },
  {
    icon: Settings,
    title: "Traditional CMSs need complete rebuilds",
    description: "Existing websites require extensive refactoring to add content management capabilities"
  },
  {
    icon: Users,
    title: "Complex workflows slow down marketing teams",
    description: "Content updates get stuck in technical bottlenecks, frustrating non-technical team members"
  },
  {
    icon: AlertCircle,
    title: "Static sites become bottlenecks for content updates",
    description: "Every change requires deployment and technical intervention, making A/B testing impossible"
  }
];

export default function Problem() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
            Tired of Waiting for Developers to{" "}
            <span className="text-red-600">Change Website Copy?</span>
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Most websites trap content behind technical barriers, creating unnecessary friction for teams that need to move fast and iterate quickly.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {problems.map((problem, index) => (
            <div
              key={index}
              className="bg-white rounded-xl p-8 border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                    <problem.icon className="h-6 w-6 text-red-600" />
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    🚫 {problem.title}
                  </h3>
                  <p className="text-gray-600">{problem.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Impact Statistics */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600 mb-2">72 hours</div>
            <p className="text-gray-600">Average time for simple copy changes</p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600 mb-2">$500+</div>
            <p className="text-gray-600">Cost per minor content update</p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600 mb-2">87%</div>
            <p className="text-gray-600">Of teams frustrated with content workflows</p>
          </div>
        </div>
      </div>
    </section>
  );
}