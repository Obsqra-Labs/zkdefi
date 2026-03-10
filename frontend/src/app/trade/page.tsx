import { redirect } from "next/navigation";

export default function TradePage() {
  redirect("/agent?v=opportunities");
}
