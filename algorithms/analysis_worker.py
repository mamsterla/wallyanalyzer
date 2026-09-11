"""Private Lambda entrypoint. It has S3 access only; report metadata stays in the signed workflow input."""
from __future__ import annotations
import hashlib
import json
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
    prefix=str(event['reportPrefix'])
    if not prefix.startswith(f"reports/{event['ownerId']}/{event['reportId']}/"):
        raise ValueError('Report prefix is invalid.')
    with TemporaryDirectory() as tmp:
        root=Path(tmp); inputs=[]
        for ordinal, item in enumerate(event['inputs']):
            local=root/f"input-{ordinal:03d}.wav" # input object names are not trusted or reused
            response=s3.get_object(Bucket=RAW_BUCKET,Key=item['objectKey'],VersionId=item['versionId'])
            body=response['Body'].read(); expected=item.get('checksumSha256')
            if expected and hashlib.sha256(body).hexdigest()!=expected:
                raise ValueError('Raw input checksum mismatch.')
            local.write_bytes(body); inputs.append(local)
        artifacts=build_tracking_error_artifacts(inputs,root/'output',str(event.get('systemSnapshot',{}).get('name','Unknown system')))
        output=[]; graph=0
        for artifact in artifacts:
            kind=artifact['kind']
            if kind=='graph_svg': graph+=1; kind=f'graph_svg_{graph}'
            key=prefix+artifact['fileName']; body=(root/'output'/artifact['fileName']).read_bytes()
            if hashlib.sha256(body).hexdigest()!=artifact['checksumSha256']:
                raise ValueError('Generated artifact checksum mismatch.')
            s3.put_object(Bucket=REPORT_BUCKET,Key=key,Body=body,ContentType=artifact['contentType'],Metadata={'sha256':artifact['checksumSha256'],'reportid':str(event['reportId'])})
            output.append({'kind':kind,'objectKey':key,'contentType':artifact['contentType'],'byteLength':len(body),'checksumSha256':artifact['checksumSha256']})
        return {'reportId':event['reportId'],'ownerId':event['ownerId'],'reportPrefix':prefix,'artifacts':output}
