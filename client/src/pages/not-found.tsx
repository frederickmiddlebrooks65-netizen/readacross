import React from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
        <p className="text-lg text-gray-600 mb-8">
          The page you're looking for doesn't exist.
        </p>
        <Link href="/">
          <Button>
            <Home className="h-4 w-4 mr-2" />
            Back to Library
          </Button>
        </Link>
      </div>
    </Layout>
  );
}