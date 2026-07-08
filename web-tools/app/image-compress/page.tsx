import ToolPage, { toolMetadata } from '@/components/ToolPage';
import ImageCompress from '@/components/tools/ImageCompress';

export const metadata = toolMetadata('image-compress');

export default function Page() {
  return (
    <ToolPage slug="image-compress">
      <ImageCompress />
    </ToolPage>
  );
}
