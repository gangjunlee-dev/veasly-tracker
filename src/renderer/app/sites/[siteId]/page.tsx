import { redirect } from "next/navigation";

export default function LegacySiteDetailPage({
  params
}: {
  params: { siteId: string };
}) {
  redirect(`/extract/${params.siteId}`);
}
