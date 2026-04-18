import { Moon, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === "dark" : false;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-9 rounded-full border-border/70 bg-card/75 px-3 text-xs text-foreground shadow-sm backdrop-blur-md hover:bg-card"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <SunMedium className="h-4 w-4 text-accent" /> : <Moon className="h-4 w-4 text-accent" />}
      <span>{isDark ? "Light mode" : "Dark mode"}</span>
    </Button>
  );
}
