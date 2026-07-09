import ToolPage, { toolMetadata } from '@/components/ToolPage';
import CharCount from '@/components/tools/CharCount';

export const metadata = toolMetadata('char-count');

export default function Page() {
  return (
    <ToolPage slug="char-count">
      <CharCount />
    </ToolPage>
  );
}
