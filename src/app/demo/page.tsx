import ReCopyFastLoader from '@/components/demo/ReCopyFastLoader';

export default function Demo() {
  return (
    <div className="min-h-screen bg-gray-50">
      <ReCopyFastLoader />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">ReCopyFast Demo</h1>
          <p className="text-gray-600">
            This demo shows how ReCopyFast works. Click on any text element below to edit it in real-time.
          </p>
        </div>

        {/* Demo Content */}
        <div className="space-y-8">
          {/* Header Section */}
          <header className="bg-blue-600 text-white p-8 rounded-lg">
            <h1 className="text-4xl font-bold mb-4">Demo Company Website</h1>
            <p className="text-xl">This is a demo site showing ReCopyFast in action</p>
          </header>

          {/* Hero Section */}
          <div className="bg-white p-8 rounded-lg shadow-md">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Our Amazing Product</h2>
            <p className="text-lg text-gray-600 mb-6">
              Transform your business with our innovative solutions. We provide cutting-edge technology 
              that helps you stay ahead of the competition.
            </p>
            <button className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-semibold">
              Get Started Today
            </button>
          </div>

          {/* Features Section */}
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Feature One</h3>
              <p className="text-gray-600">
                Our first feature delivers incredible value by automating complex processes and saving you time.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Feature Two</h3>
              <p className="text-gray-600">
                Experience seamless integration with your existing tools and workflows for maximum productivity.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Feature Three</h3>
              <p className="text-gray-600">
                Advanced analytics and reporting give you insights that drive better business decisions.
              </p>
            </div>
          </div>

          {/* CTA Section */}
          <div className="bg-blue-500 text-white p-8 rounded-lg text-center">
            <h2 className="text-2xl font-bold mb-4">Ready to Get Started?</h2>
            <p className="text-lg mb-6">
              Join thousands of satisfied customers who have transformed their business with our platform.
            </p>
            <button className="bg-white text-blue-500 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100">
              Start Your Free Trial
            </button>
          </div>

          {/* Footer */}
          <footer className="bg-gray-800 text-white p-6 rounded-lg text-center">
            <p>&copy; 2024 Demo Company. All rights reserved.</p>
          </footer>
        </div>

        {/* Instructions */}
        <div className="mt-12 bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">How to Test:</h3>
          <ol className="list-decimal list-inside text-yellow-700 space-y-1">
            <li>Click on any text element above to edit it</li>
            <li>Make changes and they will be saved automatically</li>
            <li>Open multiple browser windows to see real-time sync</li>
            <li>Check the browser console for ReCopyFast logs</li>
          </ol>
        </div>
      </div>

    </div>
  );
}