terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "9.10.0"
    }
  }
}
provider "oci" {
  region              = var.region
  config_file_profile = "RESILIENCE_LAB"
}
variable "region" { type = string }
variable "tenancy_ocid" { type = string }
variable "availability_domain" { type = string }
variable "image_ocid" {
  description = "Always Free eligible Ubuntu ARM image in your HOME region; confirm eligibility before apply"
  type        = string
}
variable "ssh_public_key" { type = string }
variable "ssh_source_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.ssh_source_cidr, 0)) && endswith(var.ssh_source_cidr, "/32")
    error_message = "SSH must be limited to your IPv4 /32."
  }
}
variable "free_tier_reviewed" {
  type    = bool
  default = false
  validation {
    condition     = var.free_tier_reviewed
    error_message = "Confirm an unupgraded Always Free account, home-region eligibility, no existing A1 usage, and capacity before planning."
  }
}
resource "oci_identity_compartment" "lab" {
  compartment_id = var.tenancy_ocid
  name           = "resilience-lab"
  description    = "Zero-cost public resilience lab"
  enable_delete  = true
}
resource "oci_core_vcn" "lab" {
  compartment_id = oci_identity_compartment.lab.id
  cidr_block     = "10.10.0.0/16"
  display_name   = "resilience-lab"
  dns_label      = "lab"
}
resource "oci_core_internet_gateway" "lab" {
  compartment_id = oci_identity_compartment.lab.id
  vcn_id         = oci_core_vcn.lab.id
  enabled        = true
}
resource "oci_core_route_table" "lab" {
  compartment_id = oci_identity_compartment.lab.id
  vcn_id         = oci_core_vcn.lab.id
  route_rules {
    network_entity_id = oci_core_internet_gateway.lab.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}
resource "oci_core_security_list" "lab" {
  compartment_id = oci_identity_compartment.lab.id
  vcn_id         = oci_core_vcn.lab.id
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
  dynamic "ingress_security_rules" {
    for_each = toset([80, 443])
    content {
      protocol = "6"
      source   = "0.0.0.0/0"
      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }
  ingress_security_rules {
    protocol = "6"
    source   = var.ssh_source_cidr
    tcp_options {
      min = 22
      max = 22
    }
  }
}
resource "oci_core_subnet" "lab" {
  compartment_id    = oci_identity_compartment.lab.id
  vcn_id            = oci_core_vcn.lab.id
  cidr_block        = "10.10.1.0/24"
  route_table_id    = oci_core_route_table.lab.id
  security_list_ids = [oci_core_security_list.lab.id]
  dns_label         = "public"
}
resource "oci_core_instance" "lab" {
  compartment_id      = oci_identity_compartment.lab.id
  availability_domain = var.availability_domain
  display_name        = "resilience-lab"
  shape               = "VM.Standard.A1.Flex"
  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }
  source_details {
    source_type             = "image"
    source_id               = var.image_ocid
    boot_volume_size_in_gbs = 50
    boot_volume_vpus_per_gb = 10
  }
  create_vnic_details {
    subnet_id        = oci_core_subnet.lab.id
    assign_public_ip = true
  }
  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = filebase64("${path.module}/cloud-init.yaml")
  }
}
output "public_ip" { value = oci_core_instance.lab.public_ip }
output "hostname" { value = "${oci_core_instance.lab.public_ip}.sslip.io" }
