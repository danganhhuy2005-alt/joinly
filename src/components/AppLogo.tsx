import { cn } from "@/lib/utils";

type AppLogoProps = {
  className?: string;
  imageClassName?: string;
};

export function AppLogo({ className, imageClassName }: AppLogoProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src="/joinly-logo.png"
        alt="Joinly"
        className={cn("h-10 w-auto object-contain", imageClassName)}
      />
    </span>
  );
}
