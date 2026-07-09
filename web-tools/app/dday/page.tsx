import ToolPage, { toolMetadata } from '@/components/ToolPage';
import Dday from '@/components/tools/Dday';

export const metadata = toolMetadata('dday');

export default function Page() {
  return (
    <ToolPage slug="dday">
      <Dday />
    </ToolPage>
  );
}
