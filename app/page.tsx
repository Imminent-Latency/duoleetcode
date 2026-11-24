import { ReviewFlagProvider } from "@/components/review-flag";
import Workspace from "@/components/workspace";
export default function Page() {
  return (
    <ReviewFlagProvider>
      <Workspace />
    </ReviewFlagProvider>
  );
}
