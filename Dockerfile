FROM lambci/lambda:build-nodejs8.10

RUN rm -f /var/lib/rpm/__db* && rpm --rebuilddb && yum clean all && \
    yum history sync && yum -y update && yum install -y yum-plugin-ovl
RUN echo -e "[main]\nplugins=1" | tee -a /etc/yum.conf
RUN touch /var/lib/rpm/*
RUN yum install -y sudo && yum reinstall mount -y && yum clean all

ENV PATH=/var/lang/bin:/usr/local/bin:/usr/bin/:/bin \
    LD_LIBRARY_PATH=/var/lang/lib:/lib64:/usr/lib64:/var/runtime:/var/runtime/lib:/var/task:/var/task/lib \
    AWS_EXECUTION_ENV=AWS_Lambda_nodejs8.10 \
    NODE_PATH=/var/runtime:/var/task:/var/runtime/node_modules

RUN rm -rf /var/runtime /var/lang && \
  curl https://lambci.s3.amazonaws.com/fs/nodejs8.10.tgz | tar -zx -C /

COPY awslambda-mock.js /var/runtime/node_modules/awslambda/build/Release/awslambda.js

RUN echo "sbx_user1051 ALL=(ALL) NOPASSWD:ALL" | tee -a /etc/sudoers

RUN mkdir /home/sbx_user1051 && chown sbx_user1051 /home/sbx_user1051
USER sbx_user1051

WORKDIR /lambda

ENTRYPOINT ["./custom-docker-setup.sh"]
