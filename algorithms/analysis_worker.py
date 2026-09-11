"""Private Lambda entrypoint. It receives opaque IDs and pinned S3 input versions only."""
from __future__ import annotations
import base64
import hashlib
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
import boto3
from wally_report_worker import build_tracking_error_artifacts

s3=boto3.client('s3')
RAW_BUCKET=os.environ['SAMPLE_BUCKET_NAME']; REPORT_BUCKET=os.environ['REPORT_BUCKET_NAME']

def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if event.get('algorithmVersion')!='1.0.0' or not isinstance(event.get('inputs'),list) or not event['inputs']:
        raise ValueError('Unsupported report worker input.')
    report_id=str(event['reportId']); prefix=str(event['outputPrefix'])
    if not prefix.startswith('reports/') or not prefix.endswith(f'/{report_id}/'):
        raise ValueError('Report prefix is invalid.')
    with TemporaryDirectory() as tmp:
        root=Path(tmp); inputs=[]
        for ordinal, item in enumerate(event['inputs']):
            local=root/f"input-{ordinal:03d}.wav"
            response=s3.get_object(Bucket=RAW_BUCKET,Key=item['objectKey'],VersionId=item['versionId'])
            body=response['Body'].read(); expected=item.get('checksumSha256')
            if not isinstance(expected,str) or base64.b64encode(hashlib.sha256(body).digest()).decode('ascii')!=expected:
                raise ValueError('Raw input checksum mismatch.')
            local.write_bytes(body); inputs.append(local)
        # System display data and report provenance remain in Postgres, outside execution state.
        artifacts=build_tracking_error_artifacts(inputs,root/'output','Recording system')
        output=[]; graph_count=0
        for artifact in artifacts:
            kind=artifact['kind']
            if kind=='graph_svg':
                graph_count+=1
                if graph_count>1: kind=f'graph_svg_{graph_count}'
            if kind=='manifest':
                continue  # only the trusted finalizer creates the provenance manifest
            key=prefix+artifact['fileName']; body=(root/'output'/artifact['fileName']).read_bytes()
            if hashlib.sha256(body).hexdigest()!=artifact['checksumSha256']:
                raise ValueError('Generated artifact checksum mismatch.')
            response=s3.put_object(Bucket=REPORT_BUCKET,Key=key,Body=body,ContentType=artifact['contentType'],ChecksumSHA256=base64.b64encode(bytes.fromhex(artifact['checksumSha256'])).decode('ascii'),Metadata={'reportid':report_id})
            version=response.get('VersionId')
            if not version: raise ValueError('Report artifact has no immutable object version.')
            output.append({'kind':kind,'objectKey':key,'objectVersionId':version,'contentType':artifact['contentType'],'byteLength':len(body),'checksumSha256':artifact['checksumSha256']})
        return {'reportId':report_id,'artifacts':output}
