import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HostClient } from "@/components/host/HostClient";

export const metadata = {
  title: "Host",
  robots: { index: false, follow: false },
};

export default async function HostPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/host/${gameId}`);

  const game = await db.game.findUnique({
    where: { id: gameId },
    select: { id: true, pin: true, hostId: true, status: true },
  });

  // Authorisation at the data boundary: being signed in isn't enough, you have
  // to be the host of this specific game.
  if (!game || game.hostId !== user.id) notFound();

  return (
    <HostClient
      gameId={game.id}
      pin={game.pin}
      joinOrigin={env.APP_ORIGIN}
      alreadyEnded={game.status === "ENDED"}
    />
  );
}
