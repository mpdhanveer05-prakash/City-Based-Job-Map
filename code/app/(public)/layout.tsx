import { SampleDataNotice } from "@/components/sample-data-notice";
import { anySynthetic } from "@/lib/data/city-data";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {anySynthetic() && <SampleDataNotice />}
      {children}
    </>
  );
}
