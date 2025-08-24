"use client";

export default function AuthCodeError() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
        <h2 className="text-2xl font-bold text-center text-red-500">Authentication Error</h2>
        <p className="text-center">
          There was an error during the authentication process. Please try again.
        </p>
        <p className="text-center">
          <a href="/login" className="text-blue-500 hover:underline">
            Go back to login
          </a>
        </p>
      </div>
    </div>
  );
}
