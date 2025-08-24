export default function SettingsPage() {
  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="px-8 pt-8 pb-4 bg-white border-b border-gray-200">
        <div className="mb-2 pl-2">
          <h1
            className="text-2xl font-normal text-gray-900"
            style={{ fontFamily: "var(--font-merriweather), serif" }}
          >
            Settings
          </h1>
          <p className="text-sm text-gray-500 mt-1">Configure your application preferences</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
          {/* Settings content */}
        </div>
      </div>
    </div>
  );
}
