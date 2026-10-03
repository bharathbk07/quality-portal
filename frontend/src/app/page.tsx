import Home from "@/features/workspace/components/workspace-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; map?: string }>;
}) {
  const { view, map } = await searchParams;
  return (
    <Home
      initialView={view}
      initialMapId={typeof map === "string" ? map : undefined}
    />
  );
}
