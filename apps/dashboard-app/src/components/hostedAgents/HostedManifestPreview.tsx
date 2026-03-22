type HostedManifestPreviewProps = {
  manifestPreview: string;
};

export function HostedManifestPreview(props: HostedManifestPreviewProps) {
  return (
    <div className="hosted-item hosted-span">
      <h3>Manifest Preview</h3>
      <textarea
        className="hosted-code"
        value={props.manifestPreview}
        readOnly
      />
    </div>
  );
}
