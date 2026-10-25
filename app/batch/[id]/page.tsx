import Buyer from './buyer';

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Buyer batchId={id} />;
}
