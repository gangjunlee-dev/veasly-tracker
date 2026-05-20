import { redirect } from "next/navigation";

export default function LegacySiteSettingsPage({
  params
}: {
  params: { siteId: string };
}) {
  redirect(`/settings/sites/${params.siteId}`);
}
