"use client";
import Image from "next/image";
import Link from "next/link";

export function AppHeader() {
  return (
    <header className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
      {/* Left side: Logo linking back to homepage or dashboard */}
      <div className="flex items-center">
        <Link href="/">
          {/* Adjust the src to match your actual logo file in /public/images/ */}
          <Image
            src="/PGU-logo-full.png"
            alt="Alpha Dog Agency"
            width={420}
            height={100}
            className="h-auto"
            priority
          />
        </Link>
      </div>

      {/* Right side: Dashboard title and subtext */}
      <div>
        <h1 className="text-3xl font-bold text-center md:text-right">
          PGU AI Dashboard
        </h1>
        <p className="text-muted-foreground text-center md:text-right">
          Manage your numbers and track missed calls
        </p>
      </div>
    </header>
  );
}
