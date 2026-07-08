import ToolPage, { toolMetadata } from '@/components/ToolPage';
import JpgToPdf from '@/components/tools/JpgToPdf';

export const metadata = toolMetadata('jpg-to-pdf');

export default function Page() {
  return (
    <ToolPage slug="jpg-to-pdf">
      <JpgToPdf />
    </ToolPage>
  );
}
