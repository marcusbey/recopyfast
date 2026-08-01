import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Code } from "lucide-react";
import Link from "next/link";

interface AuthPageShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

/**
 * Shared frame for the standalone auth pages (forgot password, reset
 * password) so they match `/login` exactly: gradient logo block above a
 * bordered card.
 */
export function AuthPageShell({
  title,
  description,
  children,
}: AuthPageShellProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center justify-center space-x-3 mb-8"
        >
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
            <Code className="w-7 h-7 text-white" />
          </div>
          <span className="font-bold text-2xl text-gray-900 tracking-tight">
            ReCopyFast
          </span>
        </Link>

        <Card className="border-gray-200 border">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
