import { getSessionFromCookieStore } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function HomePage() {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  redirect("/roles-reaction");
}
