# AWS シェイプ（mxgraph.aws4）

draw.io Desktop v31.1.8 同梱の `Sidebar-AWS4.js` から抽出した実トークン。
**ここに無い名前を推測で書かないこと** — 存在しない `resIcon` を指定しても
エラーにはならず、色だけ付いた空のタイルが描画される（実測で確認済み）。

## 指定の仕方

AWS4 は同じサービスを2通りで出せる。

| 形 | style | 見た目 |
|---|---|---|
| 製品タイル | `shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.<name>` | 角丸の色付き正方形にアイコン |
| リソース図形 | `shape=mxgraph.aws4.<name>` | アイコン単体（タイル無し） |

製品タイルの完全な style（EC2 の例。`fillColor` をカテゴリ色に差し替えて使う）:

```
sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=#ED7100;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;
```

サイズは 78×78 が既定。`aspect=fixed` と `strokeColor=#ffffff` は外さない（アイコンが白抜きで描かれる前提のため）。

## カテゴリ色

| カテゴリ | fillColor |
|---|---|
| AR & VR | `#BC1356` |
| Analytics | `#8C4FFF` |
| Application Integration | `#E7157B` |
| Artificial Intelligence | `#01A88D` |
| Blockchain | `#ED7100` |
| Business Applications | `#DD344C` |
| Cloud Financial Management | `#7AA116` |
| Compute | `#ED7100` |
| Contact Center | `#DD344C` |
| Containers | `#ED7100` |
| Customer Enablement | `#C925D1` |
| Customer Engagement | `#3334B9` |
| Database | `#C925D1` |
| Developer Tools | `#C925D1` |
| End User Computing | `#01A88D` |
| Front End Web Mobile | `#DD344C` |
| Games | `#8C4FFF` |
| General Resources | `#1E262E` |
| Internet of Things | `#7AA116` |
| Management & Governance | `#E7157B` |
| Media Services | `#ED7100` |
| Migration & Modernization | `#01A88D` |
| Network & Content Delivery | `#8C4FFF` |
| Quantum Technologies | `#ED7100` |
| Robotics | `#DD344C` |
| Satellite | `#C925D1` |
| Security, Identity & Compliance | `#DD344C` |
| Serverless | `#8C4FFF` |
| Storage | `#7AA116` |

> 色は各カテゴリのサイドバー定義から抽出したもの。迷ったら draw.io のサイドバーから
> 図形をドラッグし、右クリック → Edit Style で実物をコピーするのが確実。

## resIcon 一覧（403 件）

### AR & VR  `#BC1356`

ar_vr / sumerian

### Analytics  `#8C4FFF`

analytics / athena / clean_rooms / cloudsearch2 / data_exchange / data_pipeline / datazone / elasticsearch_service / emr / entity_resolution / finspace / glue / glue_databrew / glue_elastic_views / kinesis / kinesis_data_analytics / kinesis_data_firehose / kinesis_data_streams / kinesis_video_streams / lake_formation / managed_service_for_apache_flink / managed_streaming_for_kafka / quicksight / redshift / sagemaker_2 / sql_workbench

### Application Integration  `#E7157B`

api_gateway / appflow / application_integration / appsync / b2b_data_interchange / eventbridge / express_workflow / managed_workflows_for_apache_airflow / mobile_application / mq / sns / sqs / step_functions

### Artificial Intelligence  `#01A88D`

apache_mxnet_on_aws / app_studio / augmented_ai / bedrock / bedrock_agentcore / codeguru_2 / codewhisperer / comprehend / comprehend_medical / deep_learning_amis / deep_learning_containers / deepcomposer / deeplens / deepracer / devops_guru / elastic_inference_2 / forecast / fraud_detector / healthimaging / healthlake / healthscribe / kendra / lex / lookout_for_equipment / lookout_for_metrics / lookout_for_vision / machine_learning / monitron / neuron_ml_sdk / nova2 / omics / panorama / personalize / polly / q / rekognition_2 / sagemaker / sagemaker_ground_truth / sagemaker_studio_lab / tensorflow_on_aws / textract / torchserve / transcribe / translate

### Blockchain  `#ED7100`

blockchain / managed_blockchain / quantum_ledger_database

### Business Applications  `#DD344C`

alexa_for_business / appfabric / business_application / chime / chime_sdk / connect / end_user_messaging / honeycode / pinpoint / quick_suite / simple_email_service / supply_chain / wickr / workdocs / workmail

### Cloud Financial Management  `#7AA116`

application_cost_profiler / budgets_2 / cost_and_usage_report / cost_explorer / cost_management / custom_billing_manager / reserved_instance_reporting / savings_plans

### Compute  `#ED7100`

app_runner / auto_scaling2 / auto_scaling3 / batch / bottlerocket / compute / compute_optimizer / ec2 / ec2_image_builder / elastic_beanstalk / elastic_fabric_adapter / elastic_load_balancing / elastic_vmware_service / fargate / genomics_cli / lambda / lightsail / lightsail_for_research / local_zones / nice_dcv / nice_enginframe / nitro_enclaves / outposts / outposts_1u_and_2u_servers / outposts_family / parallel_cluster / parallel_computing_service / serverless_application_repository / simspace_weaver / vmware_cloud_on_aws / wavelength

### Contact Center  `#DD344C`

connect / contact_center

### Containers  `#ED7100`

containers / ecr / ecs / ecs_anywhere / eks / eks_anywhere / eks_cloud / eks_distro / fargate / red_hat_openshift

### Customer Enablement  `#C925D1`

activate / customer_enablement / iq / managed_services / professional_services / repost / repost_private / support / training_certification

### Customer Engagement  `#3334B9`

connect / customer_engagement / pinpoint / simple_email_service

### Database  `#C925D1`

aurora / database / database_migration_service / documentdb_with_mongodb_compatibility / dynamodb / elasticache / keyspaces / managed_apache_cassandra_service / memorydb_for_redis / neptune / oracle_database_at_aws / quantum_ledger_database / rds / rds_on_vmware / redshift / timestream

### Developer Tools  `#C925D1`

application_composer / cloud9 / cloud_control_api / cloud_development_kit / cloudshell / codeartifact / codebuild / codecatalyst / codecommit / codedeploy / codepipeline / codestar / command_line_interface / corretto / developer_tools / fault_injection_simulator / tools_and_sdks / xray

### End User Computing  `#01A88D`

appstream_20 / desktop_and_app_streaming / workdocs / worklink / workspaces / workspaces_family / workspaces_thin_client

### Front End Web Mobile  `#DD344C`

amplify / device_farm / location_service / mobile

### Games  `#8C4FFF`

gamekit / gamelift_2 / gamelift_streams / games / gamesparks / lumberyard / open_3d_engine_2

### General Resources  `#1E262E`

all_products / general / marketplace

### Internet of Things  `#7AA116`

freertos / greengrass / internet_of_things / iot_1click / iot_analytics / iot_button / iot_core / iot_device_defender / iot_device_management / iot_edukit / iot_events / iot_expresslink / iot_fleetwise / iot_roborunner / iot_sitewise / iot_things_graph / iot_twinmaker

### Management & Governance  `#E7157B`

app_config / app_wizard / application_auto_scaling / autoscaling / backint_agent / chatbot / cloudformation / cloudtrail / cloudwatch_2 / codeguru / command_line_interface / compute_optimizer / config / control_tower / devops_agent / distro_for_opentelemetry / fault_injection_simulator / license_manager / managed_service_for_grafana / managed_service_for_prometheus / managed_services / management_and_governance / management_console / mobile_application / opsworks / organizations / partner_central / personal_health_dashboard / proton / resilience_hub / resource_explorer / service_catalog / service_management_connector / systems_manager / systems_manager_incident_manager / telco_network_builder / trusted_advisor / user_notifications / well_architect_tool

### Media Services  `#ED7100`

deadline_cloud / elastic_transcoder / elemental / elemental_link / elemental_mediaconnect / elemental_mediaconvert / elemental_medialive / elemental_mediapackage / elemental_mediastore / elemental_mediatailor / interactive_video / kinesis_video_streams / media_services / nimble_studio / thinkbox_deadline / thinkbox_draft / thinkbox_frost / thinkbox_krakatoa / thinkbox_sequoia / thinkbox_stoke / thinkbox_xmesh

### Migration & Modernization  `#01A88D`

application_discovery_service / cloudendure_migration / data_transfer_terminal / database_migration_service / datasync / elastic_vmware_service / mainframe_modernization / migration_and_transfer / migration_evaluator / migration_hub / server_migration_service / snowball / snowball_edge / snowmobile / transfer_family / transfer_for_sftp / transform

### Network & Content Delivery  `#8C4FFF`

api_gateway / app_mesh / application_recovery_controller / client_vpn / cloud_directory / cloud_map / cloud_wan / cloudfront / direct_connect / elastic_load_balancing / global_accelerator / networking_and_content_delivery / private_5g / route_53 / rtb_fabric / site_to_site_vpn / transit_gateway / verified_access / vpc / vpc_lattice / vpc_privatelink

### Quantum Technologies  `#ED7100`

braket / quantum_technologies

### Robotics  `#DD344C`

robomaker / robotics

### Satellite  `#C925D1`

ground_station / satellite

### Security, Identity & Compliance  `#DD344C`

artifact / audit_manager / certificate_manager_3 / cloud_directory / cloudhsm / cognito / detective / directory_service / firewall_manager / guardduty / identity_and_access_management / inspector / key_management_service / macie / network_firewall / organizations / payment_cryptography / private_certificate_authority / resource_access_manager / secrets_manager / security_agent / security_hub / security_identity_and_compliance / security_incident_response / security_lake / shield / signer / single_sign_on / verified_permissions / waf

### Serverless  `#8C4FFF`

serverless

### Storage  `#7AA116`

backup / cloudendure_disaster_recovery / efs_infrequentaccess / efs_standard / elastic_block_store / elastic_file_system / file_cache / fsx / fsx_for_lustre / fsx_for_netapp_ontap / fsx_for_openzfs / fsx_for_windows_file_server / glacier / infrequent_access_storage_class / s3 / s3_on_outposts_storage / snowball / snowball_edge / snowcone / snowmobile / storage / storage_gateway

## よくある取り違え

| 書きがちな名前 | 実際の名前 |
|---|---|
| `iam` | `identity_and_access_management` |
| `cloudwatch` | `cloudwatch_2` |
| `opensearch_service` | resIcon には存在しない（`shape=mxgraph.aws4.<name>` 側を探すか別図形で代用する） |
| `simple_storage_service` | `s3` |
| `elastic_compute_cloud` | `ec2` |

サービスの正式名称ではなく**略称のほうが正**であることが多い。迷ったら上の一覧を検索する。

## 一覧の取り直し方

draw.io を更新したら、同梱の Sidebar から取り直せる（この一覧は v31.1.8 時点）。

```bash
# app.asar 内の Sidebar-AWS4.js から resIcon= の実トークンを抽出する
# （手順の詳細は本プラグインの scripts/ にあるコメントを参照）
```
